import * as vscode from 'vscode';
import type { FeedState } from '../application/content-service';
import type { FeedItem } from '../models/content';

const COMMAND_PREFIX = 'xiaohongshu-fisher.';

export class StatusTreeItem extends vscode.TreeItem {
	constructor(
		label: string,
		description: string,
		command?: vscode.Command,
		contextValue = 'status',
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.contextValue = contextValue;
		this.command = command;
	}
}

/** Renders application state without starting requests or accessing the platform. */
export class StatusTreeProvider
	implements vscode.TreeDataProvider<StatusTreeItem>, vscode.Disposable
{
	private readonly changeEmitter = new vscode.EventEmitter<
		StatusTreeItem | undefined | null | void
	>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private state: Readonly<FeedState> = { items: [], isLoading: false, isLoadingMore: false };

	constructor(private readonly refreshCommand: string) {}

	getTreeItem(element: StatusTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(): StatusTreeItem[] {
		if (this.state.items.length > 0) {
			const items = this.state.items.map((item) => this.toTreeItem(item));
			if (this.state.error?.code === 'unauthenticated') {
				items.unshift(this.createLoginItem());
			}
			if (this.state.isLoadingMore) {
				items.push(new StatusTreeItem(vscode.l10n.t('Loading the next page…'), '', undefined));
			}
			if (this.state.nextCursor) {
				items.push(
					new StatusTreeItem(
						vscode.l10n.t('Load More'),
						'',
						{ command: `${COMMAND_PREFIX}loadMore`, title: vscode.l10n.t('Load More') },
						'loadMore',
					),
				);
			}
			return items;
		}
		if (this.state.isLoading) {
			return [new StatusTreeItem(vscode.l10n.t('Loading…'), '', undefined)];
		}
		if (this.state.error?.code === 'unauthenticated') {
			return [this.createLoginItem()];
		}
		if (this.state.error) {
			return [
				new StatusTreeItem(this.state.error.message, vscode.l10n.t('Retry to reload'), {
					command: this.refreshCommand,
					title: vscode.l10n.t('Retry'),
				}),
			];
		}
		// An untouched view delegates onboarding to its contributed welcome content.
		if (this.state.lastUpdatedAt === undefined && this.state.query === undefined) {
			return [];
		}
		return [
			new StatusTreeItem(
				vscode.l10n.t('No content yet'),
				vscode.l10n.t('Refresh or search to start reading'),
				{
					command: this.refreshCommand,
					title: vscode.l10n.t('Refresh'),
				},
			),
		];
	}

	setState(state: Readonly<FeedState>): void {
		this.state = state;
		this.changeEmitter.fire(undefined);
	}

	refresh(): void {
		this.changeEmitter.fire(undefined);
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}

	private createLoginItem(): StatusTreeItem {
		const item = new StatusTreeItem(
			vscode.l10n.t('Scan to Log In'),
			this.state.error?.message ?? vscode.l10n.t('Log in to continue browsing'),
			{ command: `${COMMAND_PREFIX}openLogin`, title: vscode.l10n.t('Scan to Log In') },
			'login',
		);
		item.iconPath = new vscode.ThemeIcon('sign-in');
		return item;
	}

	private toTreeItem(item: FeedItem): StatusTreeItem {
		const metadata = [item.author?.name, item.mediaType === 'unknown' ? undefined : item.mediaType]
			.filter(Boolean)
			.join(' · ');
		const treeItem = new StatusTreeItem(
			item.title,
			metadata,
			{
				command: `${COMMAND_PREFIX}openNote`,
				title: vscode.l10n.t('Open Note'),
				arguments: [item],
			},
			'note',
		);
		treeItem.tooltip = item.excerpt ?? item.title;
		return treeItem;
	}
}
