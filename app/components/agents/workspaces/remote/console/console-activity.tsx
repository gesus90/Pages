import { createContext, useState } from "react";

import type { ReactNode } from "react";

interface ConsoleActivity {
  readonly isOpen: boolean;
  readonly setOpen: (isOpen: boolean) => void;
}

/** A console follows its own transport; table polling must not replace it during an outage. */
export const consoleActivityContext = createContext<ConsoleActivity>({
  isOpen: false,
  setOpen: (): void => undefined,
});

/** Shares console activity with the workspace connection table. */
export function ConsoleActivityProvider(props: {
  readonly children: ReactNode;
}): React.ReactElement {
  const [isOpen, setOpen] = useState(false);
  return (
    <consoleActivityContext.Provider value={{ isOpen, setOpen }}>
      {props.children}
    </consoleActivityContext.Provider>
  );
}
