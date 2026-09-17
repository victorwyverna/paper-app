function emptyRect(): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
  };
}

document.elementFromPoint = () => document.activeElement;
Range.prototype.getBoundingClientRect = emptyRect;
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
