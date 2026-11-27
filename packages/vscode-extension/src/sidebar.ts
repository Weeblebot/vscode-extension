import * as vscode from 'vscode';
import { errorMessage, type Weeble } from './weeble';

/** A tree item that loads its own children when expanded. */
export interface Parent {
  children(): Promise<vscode.TreeItem[]>;
}

/** A top-level group in the sidebar, such as Revisions. */
export interface Section {
  readonly label: string;
  /** Matches `viewItem` in the manifest's menus. */
  readonly contextValue: string;
  children(): Promise<vscode.TreeItem[]>;
}

class SectionItem extends vscode.TreeItem implements Parent {
  constructor(readonly section: Section) {
    super(section.label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = section.contextValue;
    this.contextValue = section.contextValue;
  }

  children(): Promise<vscode.TreeItem[]> {
    return this.section.children();
  }
}

/**
 * The Weeble sidebar: one section per feature. It stays empty until the user
 * is signed in and the folder is connected to a deployment, so the manifest's
 * welcome views can explain what to do instead.
 */
export class Sidebar implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly items: SectionItem[];
  private readonly changed = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly weeble: Weeble,
    sections: Section[],
  ) {
    this.items = sections.map((section) => new SectionItem(section));
    weeble.onDidChange(() => this.changed.fire(undefined));
  }

  /** Redraws one section, or the whole tree. */
  refresh(section?: Section): void {
    this.changed.fire(this.items.find((item) => item.section === section));
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  async getChildren(item?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!item) {
      if (!this.weeble.signedIn) return [];
      return this.weeble.project ? this.items : [];
    }
    if (!isParent(item)) return [];
    try {
      const children = await item.children();
      return children.length ? children : [message('None')];
    } catch (error) {
      return [message(errorMessage(error), 'error', 'weeble.refresh')];
    }
  }
}

/** A plain row, such as an empty state or an error. */
export function message(label: string, icon?: string, command?: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label);
  if (icon) item.iconPath = new vscode.ThemeIcon(icon);
  if (command) item.command = { command, title: label };
  item.tooltip = label;
  return item;
}

function isParent(item: vscode.TreeItem): item is vscode.TreeItem & Parent {
  return typeof (item as Partial<Parent>).children === 'function';
}
