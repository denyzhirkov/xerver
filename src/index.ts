import { Xerver } from './Xerver';

export { Xerver };

// Example usage
if (require.main === module) {
  const node = new Xerver({
    name: 'node-1',
    port: 3000,
  });

  node.setAction('echo', (args) => {
    return args;
  });

  node.start();
}
