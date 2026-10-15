/**
 * 图片预览层：黑底全屏显示一张图片，左右切换；和真机一样点一下关闭
 */

import { element } from './dom';

/** @param current 先显示的图片下标 */
export function openImagePreview(container: HTMLElement, urls: string[], current: number) {
  const layer = element('div', 'wxa-preview');
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', '图片预览');
  const image = document.createElement('img');
  image.className = 'wxa-preview-image';
  const position = element('div', 'wxa-preview-position');
  const prev = element('button', 'wxa-preview-prev', '‹');
  prev.setAttribute('aria-label', '上一张');
  const next = element('button', 'wxa-preview-next', '›');
  next.setAttribute('aria-label', '下一张');

  let shown = 0;
  const show = (index: number) => {
    shown = Math.min(Math.max(index, 0), urls.length - 1);
    image.src = urls[shown];
    position.textContent = `${shown + 1}/${urls.length}`;
    prev.style.visibility = shown > 0 ? '' : 'hidden';
    next.style.visibility = shown < urls.length - 1 ? '' : 'hidden';
  };
  prev.addEventListener('click', () => show(shown - 1));
  next.addEventListener('click', () => show(shown + 1));
  layer.addEventListener('click', event => {
    if (event.target !== prev && event.target !== next) layer.remove();
  });

  layer.append(image, position, prev, next);
  container.appendChild(layer);
  show(current);
}
