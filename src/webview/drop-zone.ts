/**
 * Drop Zone TreeView：一个原生 TreeView 组件，作为文件拖放区。
 * 从 VS Code Explorer 拖入文件时不需要 Shift（原生 DOM 不受 webview iframe 限制）。
 * handleDrop 解析 text/uri-list → 文件路径：
 *   - 图片文件 → extension host 读取为 base64 → droppedImages 消息（模拟粘贴效果）
 *   - 其他文件 → droppedFiles 消息 → webview 在 textarea 光标处插入 @ 引用
 *
 * 必须返回至少一个 TreeItem，否则 VS Code 认为视图为空、显示 viewsWelcome
 * 而非 TreeView 列表区域——viewsWelcome 区域不绑定 handleDrop。
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { ExtensionToWebviewMessage, ImageAttachmentInput } from "../shared/protocol.ts";

/** TreeView 拖放区项（仅一条提示行，确保列表区域渲染）。 */
interface DropZoneItem {
  label: string;
}

/** 支持的图片扩展名（小写，含点）。 */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** 根据文件扩展名推断 MIME type。 */
function imageMimeType(ext: string): string | null {
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    default: return null;
  }
}

/**
 * TreeDataProvider + TreeDragAndDropController for the drop zone view.
 * 接收来自 Explorer 的 text/uri-list 拖放，解析文件路径并转发到 webview。
 */
export class DropZoneProvider
  implements vscode.TreeDataProvider<DropZoneItem>, vscode.TreeDragAndDropController<DropZoneItem>
{
  static readonly viewId = "killea-deepseek-gold-harness.dropZone";

  // 接受来自 Explorer 的文件 URI 列表。
  readonly dropMimeTypes = ["text/uri-list"];
  // 不向外拖出。
  readonly dragMimeTypes: string[] = [];

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DropZoneItem[] | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private post: (msg: ExtensionToWebviewMessage) => void;
  private readonly output: vscode.OutputChannel;

  constructor(output: vscode.OutputChannel) {
    this.post = () => {};
    this.output = output;
  }

  /** 绑定 webview 消息发送函数（在 ChatViewProvider 创建后调用）。 */
  setPost(post: (msg: ExtensionToWebviewMessage) => void): void {
    this.post = post;
  }

  // 返回一条提示行，确保 TreeView 列表区域渲染（绑定 handleDrop）。
  getChildren(): DropZoneItem[] {
    return [{ label: "📦 Drag files here from Explorer" }];
  }

  getTreeItem(element: DropZoneItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);
    item.tooltip = "Drag files from VS Code Explorer here to add as @ references";
    return item;
  }

  /**
   * 处理从 Explorer 拖入的文件。
   * Explorer 拖出的数据携带 text/uri-list（URI toString 列表，\r\n 分隔）。
   * 图片文件读取为 base64 发送（模拟粘贴效果），其他文件作为 @ 引用路径发送。
   */
  async handleDrop(
    _target: DropZoneItem | undefined,
    sources: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.output.appendLine("[DropZone] handleDrop called");

    const filePaths: string[] = [];
    const imagePaths: string[] = [];
    for (const [mimeType, item] of sources) {
      this.output.appendLine(`[DropZone] MIME: ${mimeType}`);
      try {
        const data = await item.asString();
        this.output.appendLine(`[DropZone]   data: ${data.slice(0, 200)}`);

        if (mimeType === "text/uri-list") {
          for (const line of data.split(/\r?\n/)) {
            const uri = line.trim();
            if (!uri || uri.startsWith("#")) continue;
            const fsPath = vscode.Uri.parse(uri).fsPath;
            if (!fsPath) continue;
            const ext = path.extname(fsPath).toLowerCase();
            if (IMAGE_EXTENSIONS.has(ext)) {
              imagePaths.push(fsPath);
            } else {
              filePaths.push(fsPath);
            }
          }
        }
      } catch (error) {
        this.output.appendLine(`[DropZone]   error reading: ${String(error)}`);
      }
    }

    // 非图片文件 → droppedFiles（webview 在光标处插入 @ 引用）。
    const uniquePaths = [...new Set(filePaths)];
    if (uniquePaths.length > 0) {
      this.output.appendLine(`[DropZone] File paths: ${JSON.stringify(uniquePaths)}`);
      this.post({ type: "droppedFiles", paths: uniquePaths });
    }

    // 图片文件 → 读取 base64 → droppedImages（模拟粘贴效果）。
    const uniqueImagePaths = [...new Set(imagePaths)];
    if (uniqueImagePaths.length > 0) {
      this.output.appendLine(`[DropZone] Image paths: ${JSON.stringify(uniqueImagePaths)}`);
      const images: ImageAttachmentInput[] = [];
      for (const imgPath of uniqueImagePaths) {
        try {
          const ext = path.extname(imgPath).toLowerCase();
          const mediaType = imageMimeType(ext);
          if (!mediaType) continue;
          const buffer = fs.readFileSync(imgPath);
          const base64 = buffer.toString("base64");
          images.push({
            mediaType,
            data: base64,
            name: path.basename(imgPath),
          });
        } catch (error) {
          this.output.appendLine(`[DropZone]   error reading image ${imgPath}: ${String(error)}`);
        }
      }
      if (images.length > 0) {
        this.post({ type: "droppedImages", images });
      }
    }

    if (uniquePaths.length === 0 && uniqueImagePaths.length === 0) {
      this.output.appendLine("[DropZone] No file paths resolved from drop");
    }
  }
}
