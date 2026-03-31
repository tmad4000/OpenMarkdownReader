// Milkdown entry point for bundling
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/core';
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, wrapInBlockquoteCommand, insertHrCommand, wrapInHeadingCommand, insertImageCommand, wrapInBulletListCommand, wrapInOrderedListCommand, turnIntoTextCommand, toggleInlineCodeCommand } from '@milkdown/preset-commonmark';
import { history, undoCommand, redoCommand } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { callCommand } from '@milkdown/utils';

// Export everything needed
export {
  Editor, rootCtx, defaultValueCtx, editorViewCtx, commonmark, history, listener, listenerCtx, callCommand,
  toggleStrongCommand, toggleEmphasisCommand, wrapInBlockquoteCommand, insertHrCommand,
  wrapInHeadingCommand, insertImageCommand, wrapInBulletListCommand, wrapInOrderedListCommand,
  turnIntoTextCommand, toggleInlineCodeCommand, undoCommand, redoCommand
};

// Create a Milkdown editor instance
export async function createMilkdownEditor(container, initialContent, onUpdate) {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, initialContent || '');

      // Set up listener for content changes
      const listenerCtxVal = ctx.get(listenerCtx);
      if (listenerCtxVal) {
        listenerCtxVal.markdownUpdated((ctx, markdown, prevMarkdown) => {
          if (onUpdate && markdown !== prevMarkdown) {
            onUpdate(markdown);
          }
        });
      }
    })
    .use(commonmark)
    .use(history)
    .use(listener)
    .create();

  return editor;
}

// Get markdown content from editor
export function getMilkdownContent(editor) {
  if (!editor) return '';
  try {
    const ctx = editor.ctx;
    const view = ctx.get(editorViewCtx);
    const serializer = ctx.get(commonmark.schema).serializer;
    return serializer.serialize(view.state.doc);
  } catch (e) {
    console.error('Error getting milkdown content:', e);
    return '';
  }
}

// Set markdown content in editor
export function setMilkdownContent(editor, markdown) {
  if (!editor) return;
  try {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parser = ctx.get(commonmark.schema).parser;
      const doc = parser.parse(markdown || '');
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
      view.dispatch(tr);
    });
  } catch (e) {
    console.error('Error setting milkdown content:', e);
  }
}
