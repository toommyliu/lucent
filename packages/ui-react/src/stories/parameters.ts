export function isolatedStory(height: number) {
  return {
    docs: {
      story: { height: `${height}px`, inline: false },
    },
  };
}
