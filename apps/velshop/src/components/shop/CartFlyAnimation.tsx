import { useCallback, useRef } from "react";

/**
 * Creates a flying dot animation from a source element to the cart icon.
 * Uses CSS transform + opacity for 60fps performance.
 *
 * Call `fly()` with the source element (e.g. the Add to Cart button).
 * The animation finds the cart icon via `document.querySelector('[data-cart-icon]')`.
 */
export function useCartFlyAnimation() {
  const frameRef = useRef<number | null>(null);

  const fly = useCallback((sourceElement: HTMLElement | null | undefined) => {
    if (!sourceElement) return;

    const target = document.querySelector<HTMLElement>("[data-cart-icon]");
    if (!target) return;

    const sourceRect = sourceElement.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    const dot = document.createElement("div");
    dot.style.cssText = `
      position: fixed;
      z-index: 9999;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #10B981;
      pointer-events: none;
      will-change: transform, opacity;
      left: 0;
      top: 0;
    `;

    const startX = sourceRect.left + sourceRect.width / 2 - 7;
    const startY = sourceRect.top + sourceRect.height / 2 - 7;
    const endX = targetRect.left + targetRect.width / 2 - 7;
    const endY = targetRect.top + targetRect.height / 2 - 7;

    dot.style.transform = `translate3d(${startX}px, ${startY}px, 0) scale(1)`;
    dot.style.opacity = "1";
    document.body.appendChild(dot);

    const duration = 550;
    const start = performance.now();

    function animate(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const ease = 1 - Math.pow(1 - progress, 3);

      const x = startX + (endX - startX) * ease;
      const y = startY + (endY - startY) * ease;
      const scale = 1 - ease * 0.7;
      const opacity = 1 - ease * 0.3;

      dot.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      dot.style.opacity = String(opacity);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        dot.style.opacity = "0";
        dot.style.transform = `translate3d(${endX}px, ${endY}px, 0) scale(0.2)`;
        setTimeout(() => dot.remove(), 100);
      }
    }

    frameRef.current = requestAnimationFrame(animate);
  }, []);

  return { fly };
}
