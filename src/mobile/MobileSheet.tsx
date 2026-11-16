import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function MobileSheet({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="m-sheet"
      aria-labelledby={id}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="m-sheet-body">
        <div className="m-sheet-handle" />
        <div className="m-sheet-heading">
          <h2 id={id}>{title}</h2>
          <button className="m-icon" aria-label="关闭面板" onClick={close}>
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
