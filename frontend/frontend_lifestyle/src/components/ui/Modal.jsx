export default function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 16,
          width: "100%",
          maxWidth: 500,
          maxHeight: "90%",
          overflow: "auto",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
