import { createContext, useContext } from 'react';
import type { Components, ExtraProps } from 'react-markdown';
import { pressStartedOnScrollbar } from '../renderer/scrollbarPress';

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

type BlockTag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'blockquote' | 'li';
type BlockProps<Tag extends BlockTag> = React.JSX.IntrinsicElements[Tag] & ExtraProps;

/**
 * Renders `tag` with a mouseup handler that opens the editor at the block's
 * source line. The per-tag components below are thin top-level wrappers around
 * this (rather than products of a factory) so the React Compiler compiles them.
 */
function BlockElement<Tag extends BlockTag>({ tag, node, children, ...props }: BlockProps<Tag> & { tag: Tag }) {
  const Component = tag as React.ElementType;
  const { onEditClick, lineOffset } = useContext(BlockClickContext);
  const line: number = node?.position?.start.line ?? 0;

  const handleMouseUp = (e: React.MouseEvent) => {
    // Only the left button initiates editing; right-click must fall through
    // so the native context menu (Copy, etc.) can appear.
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('a, button, input')) return;

    // A scrollable descendant (e.g. an overflowing fenced code block inside a list item
    // or blockquote) bubbles its scrollbar presses up to here; using the scrollbar isn't
    // a click-to-edit. Deliberately not stopPropagation'd — the entry content area runs
    // the same check, so the press is ignored there too.
    if (pressStartedOnScrollbar()) return;

    // this check for a selection is required to be able to allow the users to click and drag the mouse to
    // select a region of text to copy, because without this check it would immediately assume that if
    // you're even clicking to make a selection it would execute the click handler and we don't want that
    // if the user is trying to simply select some text
    if (window.getSelection()?.toString()) return;
    e.stopPropagation();
    void onEditClick(line + lineOffset);
  };

  return <Component {...props} onMouseUp={handleMouseUp}>{children}</Component>;
}

function BlockP(props: BlockProps<'p'>) { return <BlockElement tag="p" {...props} />; }
function BlockH1(props: BlockProps<'h1'>) { return <BlockElement tag="h1" {...props} />; }
function BlockH2(props: BlockProps<'h2'>) { return <BlockElement tag="h2" {...props} />; }
function BlockH3(props: BlockProps<'h3'>) { return <BlockElement tag="h3" {...props} />; }
function BlockH4(props: BlockProps<'h4'>) { return <BlockElement tag="h4" {...props} />; }
function BlockH5(props: BlockProps<'h5'>) { return <BlockElement tag="h5" {...props} />; }
function BlockH6(props: BlockProps<'h6'>) { return <BlockElement tag="h6" {...props} />; }
function BlockBlockquote(props: BlockProps<'blockquote'>) { return <BlockElement tag="blockquote" {...props} />; }
function BlockLi(props: BlockProps<'li'>) { return <BlockElement tag="li" {...props} />; }

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
  p: BlockP,
  h1: BlockH1,
  h2: BlockH2,
  h3: BlockH3,
  h4: BlockH4,
  h5: BlockH5,
  h6: BlockH6,
  blockquote: BlockBlockquote,
  li: BlockLi,
};
