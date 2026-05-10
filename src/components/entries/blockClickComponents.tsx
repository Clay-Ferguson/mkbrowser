import type { Components } from 'react-markdown';

type EditClickHandler = (goToLine?: number) => void | Promise<void>;

/**
 * Returns a set of react-markdown custom components for block-level elements.
 * Clicking any of them calls handleEditClick with the source line number so
 * CodeMirror opens with the cursor already positioned at the clicked block.
 *
 * Clicks on links, buttons, or inputs are ignored so their default behaviour
 * is preserved. stopPropagation prevents the article-level double-click handler
 * from firing redundantly.
 */
export function createBlockClickComponents(handleEditClick: EditClickHandler): Partial<Components> {
  function makeHandler(line: number) {
    return (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('a, button, input')) return;
      e.stopPropagation();
      handleEditClick(line);
    };
  }

  function block<Tag extends keyof React.JSX.IntrinsicElements>(Tag: Tag) {
    return ({ node, children, ...props }: any) => {
      const line: number = node?.position?.start?.line ?? 0;
      return <Tag {...props} onClick={makeHandler(line)}>{children}</Tag>;
    };
  }

  return {
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
}
