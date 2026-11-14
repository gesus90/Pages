import { createContext, useContext, useEffect, useReducer } from "react";

import { isToastInput, SUCCESS_EVENT, TOAST_EVENT } from "./toast-events";
import { EMPTY_TOAST_STATE, reduceToasts } from "./toast-state";

import type { Dispatch, ReactNode } from "react";
import type { ToastCommand, ToastState } from "./toast-state";

interface ToastCenter extends ToastState {
  readonly dispatch: Dispatch<ToastCommand>;
}

const ToastContext = createContext<ToastCenter>({
  ...EMPTY_TOAST_STATE,
  dispatch: () => undefined,
});

/** Shares document-local pop-ups and bell history; remount at an account boundary. */
export function ToastProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement {
  const [state, dispatch] = useReducer(reduceToasts, EMPTY_TOAST_STATE);
  useEffect(() => {
    function receive(event: Event): void {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (event.type === SUCCESS_EVENT && typeof detail === "string")
        dispatch({
          type: "receive",
          notice: { type: "success", message: detail },
        });
      else if (isToastInput(detail))
        dispatch({ type: "receive", notice: detail });
    }
    window.addEventListener(TOAST_EVENT, receive);
    window.addEventListener(SUCCESS_EVENT, receive);
    return () => {
      window.removeEventListener(TOAST_EVENT, receive);
      window.removeEventListener(SUCCESS_EVENT, receive);
    };
  }, []);
  return (
    <ToastContext.Provider value={{ ...state, dispatch }}>
      {children}
    </ToastContext.Provider>
  );
}

/** Reads the single document center; isolated components without a center remain inert. */
export function useToastCenter(): ToastCenter {
  return useContext(ToastContext);
}
