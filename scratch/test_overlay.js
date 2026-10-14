// Test de positionnement et clonage de style pour overlay miroir
function createBackdropStyles(target) {
  const computed = window.getComputedStyle(target);
  const rect = target.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    width: rect.width,
    height: rect.height,
    fontSize: computed.fontSize,
    fontFamily: computed.fontFamily,
    lineHeight: computed.lineHeight,
    letterSpacing: computed.letterSpacing,
    paddingTop: computed.paddingTop,
    paddingRight: computed.paddingRight,
    paddingBottom: computed.paddingBottom,
    paddingLeft: computed.paddingLeft,
    borderWidth: computed.borderWidth,
    boxSizing: computed.boxSizing
  };
}

console.log("Overlay helper script ready");
