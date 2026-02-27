// {{PASCAL_NAME}} Modal Component — Basic Pattern

import React from 'react'
import GlobalBaseModal from '{{BASE_MODAL_IMPORT}}'
import { use{{PASCAL_NAME}}GlobalModalState } from '../../hooks'

function {{PASCAL_NAME}}Modal() {
  const { open, data, closeModal } = use{{PASCAL_NAME}}GlobalModalState()

  return (
    <GlobalBaseModal open={open} width={560} onCancel={closeModal}>
      {/* [USER] Replace this block with your modal content */}
      <div>
        <h2>{{PASCAL_NAME}}</h2>
        {/* Access typed data via `data` */}
      </div>
    </GlobalBaseModal>
  )
}

export default {{PASCAL_NAME}}Modal
