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
				items.push(new StatusTreeItem('正在加载下一页…', '', undefined));
			}
			if (this.state.nextCursor) {
				items.push(
					new StatusTreeItem(
						'加载更多',
						'',
						{ command: `${COMMAND_PREFIX}loadMore`, title: '加载更多' },
						'loadMore',
					),
				);
			}
			return items;
		}
		if (this.state.isLoading) {
			return [new StatusTreeItem('正在加载…', '', undefined)];
		}
		if (this.state.error?.code === 'unauthenticated') {
			return [this.createLoginItem()];
		}
		if (this.state.error) {
			return [
				new StatusTreeItem(this.state.error.message, '重试以重新加载', {
					command: this.refreshCommand,
					title: '重试',
				}),
			];
		}
		// An untouched view delegates onboarding to its contributed welcome content.
		if (this.state.lastUpdatedAt === undefined && this.state.query === undefined) {
			return [];
		}
		return [
			new StatusTreeItem('尚无内容', '选择刷新或搜索开始阅读', {
				command: this.refreshCommand,
				title: '刷新',
			}),
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
			'扫码登录',
			this.state.error?.message ?? '登录后继续浏览',
			{ command: `${COMMAND_PREFIX}openLogin`, title: '扫码登录' },
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
				title: '打开笔记',
				arguments: [item],
			},
			'note',
		);
		treeItem.tooltip = item.excerpt ?? item.title;
		return treeItem;
	}
}
