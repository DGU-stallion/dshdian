import { Mode } from "../types";

/** Keywords/patterns that indicate write intent */
const WRITE_INTENT_PATTERNS = [
	/\bcreate\b/i,
	/\bdelete\b/i,
	/\bremove\b/i,
	/\brename\b/i,
	/\bmove\b/i,
	/\bwrite\b/i,
	/\boverwrite\b/i,
	/\borganize\b/i,
	/\barchive\b/i,
	/\bmodify\b/i,
	/\bedit\b/i,
	/\bupdate\b/i,
	/\btag\b/i,
	/\bmerge\b/i,
	/\bsplit\b/i,
	/\btemplate\b/i,
	/创建|新建|删除|移除|重命名|改名|移动|迁移|写入|覆盖|整理|归档|修改|编辑|更新|打标签|加标签|合并|拆分|模板|批量/,
];

/** Keywords that indicate plugin generation intent */
const CREATOR_INTENT_PATTERNS = [
	/\bplugin\b/i,
	/插件|生成插件/,
	/\bgenerate\b.*\b(code|typescript)\b/i,
	/生成.*代码/,
	/\bbuild\b.*\bextension\b/i,
	/构建.*扩展/,
	/create.*plugin/i,
];

/**
 * Detects user intent from message content.
 * Used to suggest mode switch when the current mode doesn't match intent.
 */
export class IntentDetector {
	/**
	 * Detect if the message content implies a mode different from current.
	 * Returns the suggested mode, or null if no switch is needed.
	 */
	detect(content: string, currentMode: Mode): Mode | null {
		if (currentMode === Mode.Chat) {
			// Check for creator intent first (more specific)
			if (CREATOR_INTENT_PATTERNS.some(p => p.test(content))) {
				return Mode.Creator;
			}
			// Check for write intent
			if (WRITE_INTENT_PATTERNS.some(p => p.test(content))) {
				return Mode.Butler;
			}
		}
		return null;
	}

	/** Get a human-readable suggestion message */
	getSuggestionMessage(suggestedMode: Mode): string {
		switch (suggestedMode) {
			case Mode.Butler:
				return "检测到写操作意图。切换到 Standard 模式？Standard 模式可以创建、修改和删除文件。";
			case Mode.Creator:
				return "检测到插件生成意图。切换到 Create 模式？Create 模式可以生成 Obsidian 原生插件。";
			default:
				return "";
		}
	}
}
