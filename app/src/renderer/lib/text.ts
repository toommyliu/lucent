export interface TextMatchSegment {
  readonly match: boolean;
  readonly text: string;
}

export const splitTextMatches = (
  value: string,
  query: string,
): readonly TextMatchSegment[] => {
  const needle = query.toLocaleLowerCase();
  if (needle === "") {
    return [{ match: false, text: value }];
  }

  const source = value.toLocaleLowerCase();
  const segments: TextMatchSegment[] = [];
  let offset = 0;
  while (offset < value.length) {
    const index = source.indexOf(needle, offset);
    if (index < 0) {
      segments.push({ match: false, text: value.slice(offset) });
      break;
    }
    if (index > offset) {
      segments.push({ match: false, text: value.slice(offset, index) });
    }
    const end = index + needle.length;
    segments.push({ match: true, text: value.slice(index, end) });
    offset = end;
  }
  return segments;
};
