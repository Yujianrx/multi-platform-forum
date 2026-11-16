import { useEffect, useRef, useState } from 'react';

export type AvatarCrop = { left: number; top: number; size: number };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function AvatarCropper({
  src,
  disabled,
  onChange,
  onError,
}: {
  src: string;
  disabled: boolean;
  onChange: (crop: AvatarCrop | null) => void;
  onError: (message: string) => void;
}) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1),
    [position, setPosition] = useState({ x: 0.5, y: 0.5 });
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    width: number;
    size: number;
  } | null>(null);
  const { width, height } = dimensions;
  const size = Math.max(1, Math.floor(Math.min(width, height) / zoom));
  const left = Math.round(position.x * (width - size)),
    top = Math.round(position.y * (height - size));
  useEffect(() => {
    onChange(width && height ? { left, top, size } : null);
  }, [left, top, size, width, height, onChange]);
  function move(left: number, top: number) {
    setPosition({
      x: width === size ? 0.5 : clamp(left / (width - size)),
      y: height === size ? 0.5 : clamp(top / (height - size)),
    });
  }
  return (
    <div className="avatar-cropper">
      <div
        className="avatar-crop-stage"
        tabIndex={disabled ? -1 : 0}
        role="group"
        aria-label="头像裁剪区域"
        aria-describedby="avatar-crop-help"
        onPointerDown={(e) => {
          if (disabled || !width) return;
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            left,
            top,
            width: e.currentTarget.getBoundingClientRect().width,
            size,
          };
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (!start || disabled) return;
          move(
            start.left - ((e.clientX - start.x) / start.width) * start.size,
            start.top - ((e.clientY - start.y) / start.width) * start.size,
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(e) => {
          if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
            return;
          e.preventDefault();
          const step = Math.max(1, Math.round(size / (e.shiftKey ? 10 : 100)));
          move(
            left + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
            top + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0),
          );
        }}
      >
        <img
          src={src}
          alt="新头像预览"
          draggable={false}
          style={{
            width: `${(width / size) * 100}%`,
            height: `${(height / size) * 100}%`,
            left: `${(-left / size) * 100}%`,
            top: `${(-top / size) * 100}%`,
          }}
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (naturalWidth * naturalHeight > 20000000) {
              onError('图片超过 2000 万像素，请换一张图片');
              return;
            }
            setDimensions({ width: naturalWidth, height: naturalHeight });
          }}
          onError={() => onError('图片无法读取，请重新选择')}
        />
        <span className="avatar-crop-guides" aria-hidden="true" />
      </div>
      <div className="avatar-crop-controls">
        <label htmlFor="avatar-zoom">缩放</label>
        <input
          id="avatar-zoom"
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={zoom}
          disabled={disabled || !width}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => {
            setZoom(1);
            setPosition({ x: 0.5, y: 0.5 });
          }}
        >
          重置裁剪
        </button>
      </div>
      <p id="avatar-crop-help">拖动图片调整位置，滑动缩放；也可用方向键微调。</p>
    </div>
  );
}
