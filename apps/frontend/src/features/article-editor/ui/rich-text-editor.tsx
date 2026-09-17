import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useReducer } from 'react';

import type { TiptapDocument } from '@/entities/article';

import { normalizeHrefInput } from '@/shared/lib/href';

import styles from './rich-text-editor.module.css';

type RichTextEditorProps = {
  describedBy: string;
  id: string;
  invalid: boolean;
  onBlur: () => void;
  onChange: (document: TiptapDocument, isEmpty: boolean) => void;
  value: TiptapDocument;
};

type ToolbarButtonProps = {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: string;
};

function ToolbarButton({
  active,
  children,
  disabled = false,
  label,
  onClick,
}: ToolbarButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={styles.toolbarButton}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  describedBy,
  id,
  invalid,
  onBlur,
  onChange,
  value,
}: RichTextEditorProps) {
  const [, rerenderToolbar] = useReducer((version: number) => version + 1, 0);
  const editor = useEditor({
    content: value,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: false,
        underline: false,
      }),
      Link.configure({
        autolink: true,
        defaultProtocol: 'https',
        openOnClick: false,
      }),
      Underline,
    ],
    editorProps: {
      attributes: {
        'aria-describedby': describedBy,
        'aria-invalid': String(invalid),
        'aria-label': 'Article body',
        class: styles.content,
        id,
        role: 'textbox',
      },
    },
    immediatelyRender: false,
    onBlur,
    onUpdate: ({ editor: currentEditor }) => {
      const isEmpty = currentEditor.getText().trim().length === 0;
      onChange(currentEditor.getJSON() as TiptapDocument, isEmpty);
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const handleTransaction = () => rerenderToolbar();
    editor.on('transaction', handleTransaction);

    return () => {
      editor.off('transaction', handleTransaction);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setOptions({
      editorProps: {
        attributes: {
          'aria-describedby': describedBy,
          'aria-invalid': String(invalid),
          'aria-label': 'Article body',
          class: `${styles.content} ${editor.isEmpty ? styles.empty : ''}`,
          'data-placeholder': 'Tell your story…',
          id,
          role: 'textbox',
        },
      },
    });
  }, [describedBy, editor, id, invalid, editor?.isEmpty]);

  const setLink = () => {
    if (!editor) {
      return;
    }

    const currentHref = String(editor.getAttributes('link').href ?? '');
    const href = window.prompt('Link URL', currentHref);

    if (href === null) {
      return;
    }

    const normalizedHref = normalizeHrefInput(href);

    if (normalizedHref === null) {
      return;
    }

    if (!normalizedHref) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: normalizedHref, target: '_blank' })
      .run();
  };

  const unavailable = editor === null;

  return (
    <div className={styles.editor}>
      <div
        aria-label="Text formatting"
        className={styles.toolbar}
        role="toolbar"
      >
        <div className={styles.toolbarGroup}>
          <ToolbarButton
            active={editor?.isActive('heading', { level: 2 })}
            disabled={unavailable}
            label="Heading 2"
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive('heading', { level: 3 })}
            disabled={unavailable}
            label="Heading 3"
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 3 }).run()
            }
          >
            H3
          </ToolbarButton>
        </div>

        <div className={styles.toolbarGroup}>
          <ToolbarButton
            active={editor?.isActive('bold')}
            disabled={unavailable}
            label="Bold"
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            B
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive('italic')}
            disabled={unavailable}
            label="Italic"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            I
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive('strike')}
            disabled={unavailable}
            label="Strike"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            S
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive('underline')}
            disabled={unavailable}
            label="Underline"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            U
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive('code')}
            disabled={unavailable}
            label="Inline code"
            onClick={() => editor?.chain().focus().toggleCode().run()}
          >
            {'</>'}
          </ToolbarButton>
        </div>

        <div className={styles.toolbarGroup}>
          <ToolbarButton
            active={editor?.isActive('blockquote')}
            disabled={unavailable}
            label="Blockquote"
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            “ ”
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive('bulletList')}
            disabled={unavailable}
            label="Bullet list"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            • List
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive('orderedList')}
            disabled={unavailable}
            label="Ordered list"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            1. List
          </ToolbarButton>
          <ToolbarButton
            disabled={unavailable}
            label="Horizontal rule"
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          >
            —
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive('link')}
            disabled={unavailable}
            label="Link"
            onClick={setLink}
          >
            Link
          </ToolbarButton>
        </div>

        <div className={styles.toolbarGroup}>
          <ToolbarButton
            disabled={!editor?.can().chain().undo().run()}
            label="Undo"
            onClick={() => editor?.chain().focus().undo().run()}
          >
            ↶
          </ToolbarButton>
          <ToolbarButton
            disabled={!editor?.can().chain().redo().run()}
            label="Redo"
            onClick={() => editor?.chain().focus().redo().run()}
          >
            ↷
          </ToolbarButton>
        </div>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
