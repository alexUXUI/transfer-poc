// Define FallbackErrorComp component
export const FallbackErrorComp = ({ error, resetErrorBoundary }: any) => {
  return (
    <div>
      <h2>This is ErrorBoundary Component</h2>
      <p>Something went wrong:</p>
      <pre style={{ color: "red" }}>{error.message}</pre>
      <button onClick={() => resetErrorBoundary()}>
        resetErrorBoundary(try again)
      </button>
    </div>
  );
};

export const FallbackComp = <div data-test-id="loading">loading...</div>;
