import { Mode } from "../types";

/** Keywords/patterns that indicate write intent */
const WRITE_INTENT_PATTERNS = [
	/\b(create|创建|新建)\b/i,
	/\b(delete|删除|移除|remove)\b/i,
	/\b(rename|重命名|改名)\b/i,
	/\b(move|移动|迁移)\b/i,
	/\b(write|写入|覆盖|overwrite)\b/i,
	/\b(organize|整理|归档|archive)\b/i,
	/\b(modify|修改|编辑|edit|update|更新)\b/i,
	/\b(tag|打标签|加标签)\b/i,
	/\b(merge|合并)\b/i,
	/\b(split|拆分)\b/i,
	/\b(template|模板|批量)\b/i,
];

/** Keywords that indicate plugin generation intent */
const CREATOR_INTENT_PATTERNS = [
	/\b(plugin|插件|生成插件|create.*plugin)\b/i,
	/\b(generate|生成).*\b(code|代码|typescript)\b/i,
	/\b(build|构建).*\b(extension|扩展)\b/i,
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
				return "检测到写操作意图。切换到管家模式？管家模式可以创建、修改和删除文件。";
			case Mode.Creator:
				return "检测到插件生成意图。切换到创造模式？创造模式可以生成 Obsidian 原生插件。";
			default:
				return "";
		}
	}
}
