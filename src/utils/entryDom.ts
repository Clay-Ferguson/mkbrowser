export const buildEntryHeaderId = (fileName: string) => `entry-${encodeURIComponent(fileName)}`;

export const scrollItemIntoView = (fileName: string) => {
  const targetId = buildEntryHeaderId(fileName);
  const element = document.getElementById(targetId);
  element?.scrollIntoView({ block: 'center' });
};
