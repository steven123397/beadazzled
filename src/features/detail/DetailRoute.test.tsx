import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, test } from 'vitest';

import { makeIssue, renderWithI18n, TEST_TS as TS } from '@/test/fixtures';

import { DetailRoute } from './DetailRoute';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

test('opening a related issue encodes its complete id in the route', () => {
  const targetId = 'related/ 工单#?';
  const target = makeIssue(targetId, { title: 'Related ticket' });
  const current = makeIssue('bza-current', {
    dependencies: [
      {
        issue_id: 'bza-current',
        depends_on_id: targetId,
        type: 'blocks',
        created_at: TS,
      },
    ],
  });

  renderWithI18n(
    <MemoryRouter initialEntries={['/w/p1/issue/bza-current']}>
      <Routes>
        <Route
          path="/w/:projectId/issue/:issueId"
          element={<DetailRoute issues={[current, target]} />}
        />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );

  fireEvent.click(screen.getByTitle('Related ticket'));

  expect(screen.getByTestId('location')).toHaveTextContent(
    '/w/p1/issue/related%2F%20%E5%B7%A5%E5%8D%95%23%3F'
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Related ticket' })).toBeInTheDocument();
});
