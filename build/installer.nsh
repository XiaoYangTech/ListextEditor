; electron-builder NSIS 自定义脚本
; 默认安装目录固定为：Program Files\InspireWorks\ListextEditor
; （安装时仍允许用户通过「更改安装位置」选择其它目录）

; 强制要求安装包以管理员权限（UAC 提权）运行：只有 perMachine=true 时 electron-builder
; 才会给安装包声明 RequestExecutionLevel admin（即 requireAdministrator）；若被误关闭，
; 这里直接让构建失败，避免发出不需要 UAC 的安装包。
; （卸载时 multiUser.nsh 会自动通过 UAC 重新提权，保证能删除 Program Files 下的文件。）
!ifndef INSTALL_MODE_PER_ALL_USERS
  !error "Windows 安装包必须保持 nsis.perMachine=true，否则无法声明 requireAdministrator（UAC 管理员权限）"
!endif

!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\InspireWorks\ListextEditor"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\InspireWorks\ListextEditor"
!macroend
