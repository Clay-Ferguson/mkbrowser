# Index Tree

The component named `IndexTree.tsx` is the tree view panel that shows up on the left hand side of the main application window, and displays the files and folders. folders can be expanded and collapsed, files are folders can be right-button mouse clicked to navigate to that file or folder in the main browser view (i.e. the right hand side of the main application window)

## Backing Data

The data used to render this tree is a tree structure where each node is a `Types.ts#TreeNode` type. The tree component uses a lazy loading approach where the knowledge of what children are existing under any given folder is not known until the user expands the folder.

