/* eslint-disable eslint/func-style, eslint/max-statements, eslint/no-continue, eslint/no-magic-numbers, eslint/no-ternary */
import type { DailyLogVault } from './daily-log-store';
import { LinkedTaskDocument, type TaskLine } from './linked-task-document';
import { indentWidth } from './project-note';
import type { TaskDeleteMode, TaskEditPlan } from './task-edit';

type TaskEndpoint = { path: string; blockId: string };
type DailyTaskLink = { source: TaskEndpoint; copies: TaskEndpoint[]; checked: boolean };
type TaskReference = { path: string; id: string; project?: boolean };
type LocatedReference = { document: LinkedTaskDocument; line: TaskLine };
type TreeEdge = { parent: LocatedReference; child: LocatedReference };

const sameEndpoint = (left: TaskEndpoint, right: TaskEndpoint): boolean =>
	left.path === right.path && left.blockId === right.blockId;
const endpoints = (link: DailyTaskLink): TaskEndpoint[] => [link.source, ...link.copies];

class LinkedTaskOperations {
	readonly documents = new Map<string, LinkedTaskDocument>();
	readonly links: DailyTaskLink[];
	private readonly used = new Set<string>();

	constructor(
		private readonly vault: DailyLogVault,
		links: DailyTaskLink[],
	) {
		this.links = structuredClone(links);
	}

	async document(path: string): Promise<LinkedTaskDocument> {
		let document = this.documents.get(path);
		if (!document) {
			const file = this.vault.getAbstractFileByPath(path);
			if (!file) {
				throw new Error(`Linked note was not found: ${path}`);
			}
			document = new LinkedTaskDocument(path, await this.vault.read(file));
			this.documents.set(path, document);
		}
		return document;
	}

	async locate(reference: TaskReference): Promise<LocatedReference> {
		const document = await this.document(reference.path);
		return { document, line: document.locate(reference.id, reference.project).line };
	}

	private link(reference: LocatedReference): DailyTaskLink | undefined {
		const task = reference.document.at(reference.line);
		return this.links.find((link) =>
			endpoints(link).some(
				(endpoint) =>
					endpoint.path === reference.document.path && endpoint.blockId === task.blockId,
			),
		);
	}

	private async validate(link: DailyTaskLink): Promise<LocatedReference[]> {
		const result: LocatedReference[] = [];
		for (const endpoint of endpoints(link)) {
			const document = await this.document(endpoint.path);
			result.push({ document, line: document.block(endpoint.blockId).line });
		}
		return result;
	}

	private id(document: LinkedTaskDocument): string {
		const id = `tavern-${globalThis.crypto.randomUUID()}`;
		if (
			this.used.has(id) ||
			[...this.documents.values()].some((note) => note.markdown().includes(`^${id}`)) ||
			document.markdown().includes(`^${id}`)
		) {
			throw new Error('Generated task block ID already exists.');
		}
		this.used.add(id);
		return id;
	}

	private endpoint(reference: LocatedReference): TaskEndpoint {
		let id = reference.document.at(reference.line).blockId;
		if (!id) {
			id = this.id(reference.document);
			reference.document.assignId(reference.line, id);
		}
		return { path: reference.document.path, blockId: id };
	}

	private async membership(reference: LocatedReference): Promise<DailyTaskLink | undefined> {
		const existing = this.link(reference);
		if (existing) {
			await this.validate(existing);
			return existing;
		}
		const parent = reference.document.parent(reference.line);
		if (!parent) {
			return undefined;
		}
		const parentReference = { document: reference.document, line: parent.line };
		const parentLink = await this.membership(parentReference);
		if (!parentLink) {
			return undefined;
		}
		const parents = await this.validate(parentLink);
		const previousLinks = new Set(this.links);
		for (const destination of parents) {
			if (destination.line === parent.line && destination.document === reference.document) {
				continue;
			}
			const siblings = reference.document
				.tasks()
				.filter((task) => reference.document.parent(task.line)?.line === parent.line);
			const index = siblings.findIndex((task) => task.line === reference.line);
			const before = siblings
				.slice(0, index)
				.reverse()
				.find((task) => this.link({ document: reference.document, line: task.line }));
			const after = siblings
				.slice(index + 1)
				.find((task) => this.link({ document: reference.document, line: task.line }));
			const neighbor = before ?? after;
			let anchor = destination.line;
			let placement: 'child' | 'before' | 'after' = 'child';
			if (neighbor) {
				const neighbors = await this.validate(
					this.link({ document: reference.document, line: neighbor.line })!,
				);
				const group = new Set(destination.document.group(destination.line));
				const counterpart = neighbors.find(
					(candidate) => candidate.document === destination.document && group.has(candidate.line),
				);
				if (counterpart) {
					anchor = counterpart.line;
					placement = before ? 'after' : 'before';
				}
			}
			await this.cloneTree(reference, destination.document, anchor, placement);
		}
		for (const created of this.links.filter((link) => !previousLinks.has(link))) {
			const canonical = endpoints(created).find(
				(endpoint) => endpoint.path === parentLink.source.path,
			)!;
			created.copies = endpoints(created).filter((endpoint) => !sameEndpoint(endpoint, canonical));
			created.source = canonical;
		}
		const created = this.link(reference)!;
		return created;
	}

	private async references(
		reference: LocatedReference,
		synchronizeTree = true,
	): Promise<LocatedReference[]> {
		const link = await this.membership(reference);
		if (!link) {
			return [reference];
		}
		const related = await this.validate(link);
		if (synchronizeTree) {
			for (const endpoint of related) {
				const group = new Set(endpoint.document.group(endpoint.line));
				for (const task of endpoint.document
					.tasks()
					.filter((candidate) => group.has(candidate.line))) {
					await this.membership({ document: endpoint.document, line: task.line });
				}
			}
		}
		await this.validateGroups(related);
		return related;
	}

	async edit(reference: TaskReference, plan: TaskEditPlan): Promise<void> {
		const origin = await this.locate(reference);
		const related = await this.references(origin);
		const additions: { document: LinkedTaskDocument; lines: TaskLine[] }[] = [];
		for (const endpoint of related) {
			additions.push({
				document: endpoint.document,
				lines: endpoint.document.edit(endpoint.line, plan),
			});
		}
		if (related.length > 1) {
			for (let index = 0; index < (additions[0]?.lines.length ?? 0); index += 1) {
				const created = additions.map((entry) =>
					this.endpoint({ document: entry.document, line: entry.lines[index]! }),
				);
				this.links.push({ source: created[0]!, copies: created.slice(1), checked: false });
			}
		}
		this.prune();
	}

	async delete(reference: TaskReference, mode: TaskDeleteMode): Promise<void> {
		const origin = await this.locate(reference);
		const related = await this.references(origin);
		const targets = mode === 'tree' ? await this.treeClosure(related) : related;
		for (const endpoint of targets) {
			if (endpoint.document.lines.includes(endpoint.line)) {
				endpoint.document.delete(endpoint.line, mode);
			}
		}
		this.prune();
	}

	async checked(reference: TaskReference, checked: boolean, synchronizeTree = true): Promise<void> {
		const origin = await this.locate(reference);
		const related =
			synchronizeTree && checked
				? await this.alignTree(origin)
				: await this.references(origin, synchronizeTree);
		for (const endpoint of related) {
			endpoint.document.setChecked(endpoint.line, checked);
			if (checked && endpoint.document.isProject) {
				endpoint.document.moveSection(endpoint.line, 'Done');
			}
		}
		const link = this.link(origin);
		if (link) {
			link.checked = checked;
		}
	}

	async section(reference: TaskReference, section: string): Promise<void> {
		const related = await this.alignTree(await this.locate(reference));
		await this.validateGroups(related);
		for (const endpoint of related) {
			endpoint.document.moveSection(endpoint.line, section);
		}
	}

	async move(
		reference: TaskReference,
		targetReference: TaskReference,
		placement: 'before' | 'after' | 'child',
	): Promise<void> {
		if (reference.path !== targetReference.path) {
			throw new Error('Tasks must belong to the same project.');
		}
		const origin = await this.locate(reference);
		const target = await this.locate(targetReference);
		if (origin.line === target.line) {
			return;
		}
		const group = new Set(origin.document.group(origin.line));
		if (group.has(target.line)) {
			throw new Error('Cannot move a task inside its own children.');
		}
		const related = await this.alignTree(origin);
		await this.validateGroups(related);
		await this.membership(target);
		if (related.length === 1) {
			origin.document.move(origin.line, target.line, placement);
			await this.references(origin);
			return;
		}
		const destinations: LocatedReference[] = [];
		const used = new Set<TaskLine>([target.line]);
		for (const endpoint of related) {
			const occurrence = related
				.filter((candidate) => candidate.document === endpoint.document)
				.findIndex((candidate) => candidate.line === endpoint.line);
			const destination =
				endpoint.document === origin.document && endpoint.line === origin.line
					? target
					: await this.destination(target, {
							document: endpoint.document,
							exclude: used,
							context: endpoint.line,
							occurrence,
						});
			used.add(destination.line);
			destinations.push(destination);
		}
		for (const [index, endpoint] of related.entries()) {
			endpoint.document.move(endpoint.line, destinations[index]!.line, placement);
		}
	}

	async reorder(reference: TaskReference, direction: 'up' | 'down'): Promise<void> {
		const origin = await this.locate(reference);
		const root = origin.document.at(origin.line);
		const parent = origin.document.parent(origin.line);
		const siblings = origin.document
			.tasks()
			.filter(
				(task) =>
					task.sectionName === root.sectionName &&
					indentWidth(task.indent) === indentWidth(root.indent) &&
					origin.document.parent(task.line)?.line === parent?.line,
			);
		const index = siblings.findIndex((task) => task.line === origin.line);
		const target = siblings[index + (direction === 'up' ? -1 : 1)];
		if (target) {
			await this.move(
				reference,
				{ path: reference.path, id: target.id },
				direction === 'up' ? 'before' : 'after',
			);
		}
	}

	private async alignTree(origin: LocatedReference): Promise<LocatedReference[]> {
		let related = await this.references(origin);
		const edges = new Map<DailyTaskLink, TreeEdge>();
		for (const endpoint of await this.treeClosure(related)) {
			const group = new Set(endpoint.document.group(endpoint.line));
			for (const task of endpoint.document
				.tasks()
				.filter((candidate) => group.has(candidate.line) && candidate.line !== endpoint.line)) {
				const child = { document: endpoint.document, line: task.line };
				const link = this.link(child);
				const parent = endpoint.document.parent(task.line);
				if (link && parent && group.has(parent.line) && !edges.has(link)) {
					edges.set(link, { parent: { document: endpoint.document, line: parent.line }, child });
				}
			}
		}
		for (const link of edges.keys()) {
			const visited = new Set<DailyTaskLink>();
			let current: DailyTaskLink | undefined = link;
			while (current) {
				if (visited.has(current)) {
					throw new Error('Cannot move a task inside its own children.');
				}
				visited.add(current);
				const parent: LocatedReference | undefined = edges.get(current)?.parent;
				current = parent ? this.link(parent) : undefined;
			}
		}
		for (const [link, edge] of edges) {
			for (const child of await this.validate(link)) {
				const currentParent = child.document.parent(child.line);
				const expected = this.link(edge.parent);
				if (
					currentParent &&
					(currentParent.line === edge.parent.line ||
						(expected &&
							this.link({ document: child.document, line: currentParent.line }) === expected))
				) {
					continue;
				}
				const destination = await this.destination(edge.parent, {
					document: child.document,
					context: child.line,
				});
				const insertion = await this.insertionPoint(edge, destination);
				child.document.move(child.line, insertion.line, insertion.placement);
			}
		}
		const rootLink = this.link(origin);
		if (rootLink) {
			related = await this.validate(rootLink);
		}
		for (const [link, edge] of edges) {
			const parentLink = this.link(edge.parent);
			const parents = parentLink ? await this.validate(parentLink) : [edge.parent];
			for (const parent of parents) {
				const children = await this.validate(link);
				if (
					!children.some(
						(child) =>
							child.document === parent.document &&
							child.document.parent(child.line)?.line === parent.line,
					)
				) {
					const insertion = await this.insertionPoint(edge, parent);
					await this.cloneTree(edge.child, parent.document, insertion.line, insertion.placement);
				}
			}
		}
		return related;
	}

	private async treeClosure(
		initial: LocatedReference[],
		adoptAdditions = true,
	): Promise<LocatedReference[]> {
		const queue = [...initial];
		const groups: LocatedReference[] = [];
		const visitedLines = new Set<TaskLine>();
		const visitedLinks = new Set<DailyTaskLink>();
		for (let index = 0; index < queue.length; index += 1) {
			const endpoint = queue[index]!;
			if (visitedLines.has(endpoint.line)) {
				continue;
			}
			visitedLines.add(endpoint.line);
			groups.push(endpoint);
			const group = new Set(endpoint.document.group(endpoint.line));
			for (const task of endpoint.document
				.tasks()
				.filter((candidate) => group.has(candidate.line))) {
				const reference = { document: endpoint.document, line: task.line };
				const link =
					this.link(reference) ?? (adoptAdditions ? await this.membership(reference) : undefined);
				if (link && !visitedLinks.has(link)) {
					visitedLinks.add(link);
					queue.push(...(await this.validate(link)));
				}
			}
		}
		return groups;
	}

	private async insertionPoint(
		edge: TreeEdge,
		destination: LocatedReference,
	): Promise<{ line: TaskLine; placement: 'after' | 'child' }> {
		const child = edge.child.document.at(edge.child.line);
		const preceding = edge.parent.document
			.tasks()
			.filter(
				(task) =>
					task.lineIndex < child.lineIndex &&
					edge.parent.document.parent(task.line)?.line === edge.parent.line,
			)
			.reverse();
		for (const sibling of preceding) {
			const link = this.link({ document: edge.parent.document, line: sibling.line });
			if (!link || link === this.link(edge.child)) {
				continue;
			}
			const previous = (await this.validate(link)).find(
				(candidate) =>
					candidate.document === destination.document &&
					candidate.document.parent(candidate.line)?.line === destination.line,
			);
			if (previous) {
				return { line: previous.line, placement: 'after' };
			}
		}
		return { line: destination.line, placement: 'child' };
	}

	private async validateGroups(related: LocatedReference[]): Promise<void> {
		for (const endpoint of related) {
			const group = new Set(endpoint.document.group(endpoint.line));
			for (const task of endpoint.document
				.tasks()
				.filter((candidate) => group.has(candidate.line))) {
				const link = this.link({ document: endpoint.document, line: task.line });
				if (link) {
					await this.validate(link);
				}
			}
		}
	}

	private async destination(
		origin: LocatedReference,
		options: {
			document: LinkedTaskDocument;
			exclude?: Set<TaskLine>;
			context?: TaskLine;
			occurrence?: number;
		},
	): Promise<LocatedReference> {
		const { document, exclude, context, occurrence = 0 } = options;
		if (document === origin.document && !exclude?.has(origin.line)) {
			return origin;
		}
		const link = this.link(origin);
		if (link) {
			const allCandidates = (await this.validate(link)).filter(
				(candidate) => candidate.document === document,
			);
			const candidates = allCandidates.filter((candidate) => !exclude?.has(candidate.line));
			let ancestor = context ? document.parent(context) : undefined;
			while (ancestor) {
				const group = new Set(document.group(ancestor.line));
				const contextual = candidates.find((candidate) => group.has(candidate.line));
				if (contextual) {
					return contextual;
				}
				ancestor = document.parent(ancestor.line);
			}
			const indexed = allCandidates[occurrence];
			let existing = exclude ? candidates[0] : undefined;
			if (indexed && !exclude?.has(indexed.line)) {
				existing = indexed;
			}
			if (existing) {
				return existing;
			}
		}
		const parent = origin.document.parent(origin.line);
		const destinationParent = parent
			? await this.destination(
					{ document: origin.document, line: parent.line },
					{ document, context, occurrence },
				)
			: undefined;
		const task = origin.document.at(origin.line);
		const endpoint = this.endpoint(origin);
		const clone = document.newLine(task.line.raw.replace(/\s*\^[A-Za-z0-9-]+\s*$/, ''));
		const indent = destinationParent ? `${document.at(destinationParent.line).indent}  ` : '';
		document.reindent([clone], task.indent, indent);
		const index = destinationParent
			? document.lines.indexOf(destinationParent.line) + 1
			: document.sectionIndex(task.sectionName || 'Plan');
		document.insert(index, [clone]);
		const copied = this.endpoint({ document, line: clone });
		if (link) {
			link.copies.push(copied);
		} else {
			this.links.push({ source: endpoint, copies: [copied], checked: task.checked });
		}
		return { document, line: clone };
	}

	async copy(
		reference: TaskReference,
		destinationPath: string,
		target?: { id: string; placement: 'before' | 'after' | 'child' },
	): Promise<void> {
		const origin = await this.locate(reference);
		const destination = await this.document(destinationPath);
		const anchor = target ? destination.locate(target.id).line : undefined;
		await this.validateGroups([origin]);
		if (anchor && target) {
			const parent = target.placement === 'child' ? anchor : destination.parent(anchor)?.line;
			if (parent) {
				const sourceGroups = await this.treeClosure([origin], false);
				if (
					sourceGroups.some(
						(endpoint) =>
							endpoint.document === destination &&
							endpoint.document.group(endpoint.line).includes(parent),
					)
				) {
					throw new Error('Cannot move a task inside its own children.');
				}
				const parents = await this.references({ document: destination, line: parent });
				const used = new Set<TaskLine>([anchor]);
				for (const endpoint of parents) {
					let counterpart = anchor;
					if (endpoint.document !== destination || endpoint.line !== parent) {
						counterpart =
							target.placement === 'child'
								? endpoint.line
								: (
										await this.destination(
											{ document: destination, line: anchor },
											{ document: endpoint.document, context: endpoint.line, exclude: used },
										)
									).line;
					}
					used.add(counterpart);
					await this.cloneTree(origin, endpoint.document, counterpart, target.placement);
				}
				return;
			}
		}
		await this.cloneTree(origin, destination, anchor, target?.placement);
	}

	async carryForward(previousPath: string, destinationPath: string): Promise<void> {
		if (previousPath === destinationPath) {
			return;
		}
		const previous = await this.document(previousPath);
		const destination = await this.document(destinationPath);
		const tasks = previous.tasks();
		const groups = tasks
			.filter((task) => !previous.parent(task.line))
			.map((root) => ({ root, lines: previous.group(root.line) }))
			.filter(({ lines }) => tasks.some((task) => lines.includes(task.line) && !task.checked));
		const selected = new Set(groups.flatMap(({ lines }) => lines));
		const blockIds = new Set<string>();
		for (const task of tasks.filter((candidate) => selected.has(candidate.line))) {
			previous.locate(task.id);
			if (task.blockId) {
				blockIds.add(task.blockId);
			}
		}
		for (const link of this.links.filter((candidate) =>
			endpoints(candidate).some(
				(endpoint) => endpoint.path === previousPath && blockIds.has(endpoint.blockId),
			),
		)) {
			await this.validate(link);
		}
		const destinationIds = new Set(
			destination.lines.flatMap((line) => {
				const id = line.raw.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/)?.[1];
				return id ? [id] : [];
			}),
		);
		for (const line of selected) {
			const id = line.raw.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/)?.[1];
			if (id && destinationIds.has(id)) {
				throw new Error(`Daily carry-forward block ^${id} already exists in the destination.`);
			}
		}
		const trees = groups.map(({ root, lines }) => ({
			line: root.line,
			markdown: lines.map((line) => line.raw).join('\n'),
		}));
		for (const tree of trees) {
			destination.insertTree(tree.markdown);
		}
		for (const tree of trees) {
			previous.delete(tree.line, 'tree');
		}
		for (const link of this.links) {
			for (const endpoint of endpoints(link)) {
				if (endpoint.path === previousPath && blockIds.has(endpoint.blockId)) {
					endpoint.path = destinationPath;
				}
			}
		}
		this.documents.delete(previousPath);
		this.documents.set(previousPath, previous);
	}

	// eslint-disable-next-line eslint/max-params
	private async cloneTree(
		origin: LocatedReference,
		destination: LinkedTaskDocument,
		target?: TaskLine,
		placement: 'before' | 'after' | 'child' = 'child',
	): Promise<void> {
		const group = origin.document.group(origin.line);
		const sourceTasks = new Map(
			origin.document
				.tasks()
				.filter((task) => group.includes(task.line))
				.map((task) => [task.line, task]),
		);
		for (const task of sourceTasks.values()) {
			const link = this.link({ document: origin.document, line: task.line });
			if (link) {
				await this.validate(link);
			}
		}
		const created: { source: TaskEndpoint; copyId: string; checked: boolean }[] = [];
		const rows = group.map((line) => {
			const task = sourceTasks.get(line);
			if (!task) {
				return destination.newLine(line.raw);
			}
			const source = this.endpoint({ document: origin.document, line });
			const copyId = this.id(destination);
			const clone = destination.newLine(line.raw.replace(/\s*\^[A-Za-z0-9-]+\s*$/, ` ^${copyId}`));
			created.push({ source, copyId, checked: task.checked });
			return clone;
		});
		destination.insertTree(
			rows.map((line) => line.raw).join('\n'),
			target ? { line: target, placement } : undefined,
		);
		for (const task of created) {
			const copy = { path: destination.path, blockId: task.copyId };
			const link = this.links.find((entry) =>
				endpoints(entry).some((endpoint) => sameEndpoint(endpoint, task.source)),
			);
			if (link) {
				link.copies.push(copy);
			} else {
				this.links.push({ source: task.source, copies: [copy], checked: task.checked });
			}
		}
	}

	private prune(): void {
		const exists = (endpoint: TaskEndpoint): boolean => {
			const document = this.documents.get(endpoint.path);
			return !document || document.tasks().some((task) => task.blockId === endpoint.blockId);
		};
		const retained = this.links
			.filter((link) => exists(link.source))
			.map((link) => ({ ...link, copies: link.copies.filter(exists) }))
			.filter((link) => link.copies.length > 0);
		this.links.splice(0, this.links.length, ...retained);
	}
}

export { LinkedTaskOperations, endpoints, sameEndpoint };
export type { DailyTaskLink, TaskEndpoint, TaskReference };
