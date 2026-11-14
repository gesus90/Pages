import { ToastItem } from "./toast/toast-item";
import { useToastCenter } from "./toast/toast-provider";

export { showSuccessToast, showToast } from "./toast/toast-events";
export { ToastProvider } from "./toast/toast-provider";
export type { ToastAction, ToastInput } from "./toast/toast-types";

/** Displays the document's three newest notices below the fixed 76 px header. */
export function Toaster(): React.ReactElement {
  const { messages, dispatch } = useToastCenter();
  return (
    <div className="pointer-events-none fixed inset-x-2 top-23 z-60 flex flex-col items-end gap-2 sm:left-auto sm:right-5 sm:w-88">
      {messages.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => dispatch({ type: "dismiss", id: toast.id })}
        />
      ))}
    </div>
  );
}
