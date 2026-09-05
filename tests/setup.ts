// Test setup for Node environment
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {}
    }
  };
}
