export const ARTICLE_TITLE_MAX_LENGTH = 200;

export type TiptapMark = {
  type: "bold" | "italic" | "strike" | "underline" | "code" | "link";
  attrs?: Record<string, unknown>;
};

export type TiptapNode = {
  type:
    | "paragraph"
    | "text"
    | "heading"
    | "blockquote"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "codeBlock"
    | "horizontalRule"
    | "hardBreak"
    | "image";
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  text?: string;
  content?: TiptapNode[];
};

export type TiptapDocument = {
  type: "doc";
  content: TiptapNode[];
};
