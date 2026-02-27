// GlobalBaseModal — UI Library Agnostic Interface
// This is a thin wrapper around your UI library's Modal/Dialog component.
// Replace the implementation below with your actual UI library.

import React from 'react'

// --- Interface Definition (stable across UI libraries) ---

export interface GlobalBaseModalProps {
  /** Whether the modal is visible */
  open: boolean
  /** Called when the modal requests to close (overlay click, escape key, X button) */
  onCancel: () => void
  /** Modal width (number for px, string for custom units) */
  width?: number | string
  /** Additional CSS class names */
  className?: string
  /** Modal content */
  children?: React.ReactNode
}

// --- Implementation (adapt to your UI library) ---

// [USER] Replace the fallback implementation below with your UI library's Modal component.
//
// Examples:
//
// Ant Design:
//   import { Modal } from 'antd'
//   <Modal open={open} onCancel={onCancel} width={width} footer={null} destroyOnClose>
//     {children}
//   </Modal>
//
// Material UI:
//   import { Dialog } from '@mui/material'
//   <Dialog open={open} onClose={onCancel} maxWidth={false}>
//     <div style={{ width }}>{children}</div>
//   </Dialog>
//
// Radix UI / shadcn:
//   import { Dialog, DialogContent } from '@/components/ui/dialog'
//   <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
//     <DialogContent className={className} style={{ maxWidth: width }}>
//       {children}
//     </DialogContent>
//   </Dialog>
//
// Headless UI:
//   import { Dialog } from '@headlessui/react'
//   <Dialog open={open} onClose={onCancel}>
//     <div className="fixed inset-0 bg-black/30" />
//     <div className="fixed inset-0 flex items-center justify-center">
//       <Dialog.Panel style={{ width }}>{children}</Dialog.Panel>
//     </div>
//   </Dialog>

function GlobalBaseModal(props: GlobalBaseModalProps) {
  const { open, onCancel, width = 560, className, children } = props

  if (!open) return null

  return (
    <div
      className={className}
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      {/* Overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
        }}
        onClick={onCancel}
      />
      {/* Content */}
      <div
        style={{
          position: 'relative',
          width: typeof width === 'number' ? `${width}px` : width,
          maxHeight: '90vh',
          overflow: 'auto',
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '24px',
        }}
      >
        {children}
      </div>
    </div>
  )
}

export default GlobalBaseModal
