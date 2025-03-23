import { BrowserRouter, Routes, Route } from "react-router";
import { DataTransferMfe } from "./features/data-transfer";
import { GenericServiceMfe } from "./features/generic-service";

const App = () => {
  return (
    <div>
      <BrowserRouter basename="/">
        <Routes>
          <Route path="/" Component={() => <div>Home</div>} />
          <Route
            path="/transfer"
            Component={() => <DataTransferMfe style={{ color: "red" }} />}
          />
          <Route
            path="/service"
            Component={() => <GenericServiceMfe style={{ color: "blue" }} />}
          />
        </Routes>
      </BrowserRouter>
    </div>
  );
};

export default App;
