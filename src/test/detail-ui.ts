import { fireEvent, within } from '@testing-library/react';

/** Pick a status from the detail rail's popover (its radios live inside `<details>`). */
export function chooseStatus(option: RegExp) {
  const details = document.querySelector<HTMLDetailsElement>('details[aria-label="Status"]');
  if (details === null) {
    throw new Error('no Status menu');
  }
  details.open = true;
  fireEvent.click(within(details).getByRole('radio', { name: option }));
}
