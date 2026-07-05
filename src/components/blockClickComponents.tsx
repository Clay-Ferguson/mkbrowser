import { createContext, useContext } from 'react';
import type { Components, ExtraProps } from 'react-markdown';

type EditClickHandler = (goToLine?: number) => void | Promise<void>;

/**
 * Supplies the edit-click handler and column line offset to the block-click
 * components. Passing these via context (rather than closing over them in a
 * per-render factory) keeps the component *types* module-stable, so React
 * reconciles block elements in place instead of remounting the whole subtree
 * on every render.
 */
export const BlockClickContext = createContext<{ onEditClick: EditClickHandler; lineOffset: number }>({
  onEditClick: () => {},
  lineOffset: 0,
});

function block<Tag extends keyof React.JSX.IntrinsicElements>(Tag: Tag) {
  const Component = Tag as React.ElementType;
  const BlockComponent = ({ node, children, ...props }: React.JSX.IntrinsicElements[Tag] & ExtraProps) => {
    const { onEditClick, lineOffset } = useContext(BlockClickContext);
    const line: number = node?.position?.start.line ?? 0;

    const handleMouseUp = (e: React.MouseEvent) => {
      // Only the left button initiates editing; right-click must fall through
      // so the native context menu (Copy, etc.) can appear.
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('a, button, input')) return;

      // this check for a selection is required to be able to allow the users to click and drag the mouse to
      // select a region of text to copy, because without this check it would immediately assume that if
      // you're even clicking to make a selection it would execute the click handler and we don't want that
      // if the user is trying to simply select some text
      if (window.getSelection()?.toString()) return;
      e.stopPropagation();
      void onEditClick(line + lineOffset);
    };

    return <Component {...props} onMouseUp={handleMouseUp}>{children}</Component>;
  };
  BlockComponent.displayName = `Block(${String(Tag)})`;
  return BlockComponent;
}

/**
 * react-markdown custom components for block-level elements. Clicking any of
 * them calls the context's onEditClick with the source line number so
 * CodeMirror opens with the cursor already positioned at the clicked block.
 *
 * Clicks on links, buttons, or inputs are ignored so their default behaviour
 * is preserved. stopPropagation prevents the article-level double-click handler
 * from firing redundantly.
 */
export const blockClickComponents: Partial<Components> = {
  p: block('p'),
  h1: block('h1'),
  h2: block('h2'),
  h3: block('h3'),
  h4: block('h4'),
  h5: block('h5'),
  h6: block('h6'),
  blockquote: block('blockquote'),
  li: block('li'),
};
