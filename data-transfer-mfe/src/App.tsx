import React, { useEffect, useState } from "react";
import "./App.css";
import DataTransfer from "./components/DataTransfer";
import "./components/DataTransfer.css";
import { dataTransferService } from "./services/data-transfer";

const App = () => {
  const [isComponentMounted, setIsComponentMounted] = useState(true);
  const [transferActive, setTransferActive] = useState(false);

  // Check if there's an active transfer on mount
  useEffect(() => {
    const checkActiveTransfer = async () => {
      const session = await dataTransferService.getCurrentSession();
      if (
        session &&
        ["active", "initializing", "paused"].includes(session.status)
      ) {
        setTransferActive(true);
      }
    };

    checkActiveTransfer();

    // Clean up when the app unmounts
    return () => {
      // This doesn't stop the transfer, just cleans up event listeners
      dataTransferService.unmount();
    };
  }, []);

  // Handle component unmounting (simulates navigation away from the component)
  const toggleComponent = () => {
    if (isComponentMounted) {
      // Check if transfer is active before unmounting
      if (dataTransferService.isTransferInProgress()) {
        setTransferActive(true);
      }
    }
    setIsComponentMounted(!isComponentMounted);
  };

  // Handle notification when DataTransfer is unmounted
  const handleDataTransferUnmount = () => {
    // Check if there's an active transfer after unmount
    if (dataTransferService.isTransferInProgress()) {
      setTransferActive(true);
    }
  };

  return (
    <div className="content">
      <h1>Data Transfer MFE</h1>

      {transferActive && !isComponentMounted && (
        <div className="transfer-background-notification">
          <div className="notification-content">
            <p>Data transfer is running in the background</p>
            <button onClick={() => setIsComponentMounted(true)}>
              Show Transfer UI
            </button>
          </div>
        </div>
      )}

      <div className="controls">
        <button onClick={toggleComponent}>
          {isComponentMounted ? "Unmount Component" : "Mount Component"}
        </button>
        <p className="note">
          (This button simulates navigating away from the component while
          keeping the app running)
        </p>
      </div>

      {isComponentMounted && (
        <DataTransfer onUnmount={handleDataTransferUnmount} />
      )}
    </div>
  );
};

export default App;
