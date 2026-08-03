// For action controls inside DataTable rows that have onRowClick — without this,
// the click bubbles to the row and also opens the row's detail/roster modal.
export function withStopPropagation(handler: () => void) {
  return (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    handler();
  };
}
