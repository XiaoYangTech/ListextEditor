; electron-builder NSIS 自定义脚本
; 默认安装目录固定为：Program Files\InspireWorks\ListextEditor
; （安装时仍允许用户通过「更改安装位置」选择其它目录）
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\InspireWorks\ListextEditor"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$PROGRAMFILES64\InspireWorks\ListextEditor"
!macroend
