import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only unmounts between tests automatically when Vitest globals are enabled,
// and they are not here. Without this, each test renders on top of the previous test's DOM —
// which is how the second gate test first "found" two verdict panels.
afterEach(() => {
  cleanup();
});
