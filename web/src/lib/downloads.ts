//https://github.com/dont-be-evil-company/p2p.kiwi/releases/download/latest/p2p-kiwi_amd64.deb
export const DOWNLOAD_BASE_URL =
	'https://github.com/dont-be-evil-company/p2p.kiwi/releases/latest/download/';

export const DOWNLOAD_URLS = {
	LINUX_DEB_AMD64: `${DOWNLOAD_BASE_URL}p2p-kiwi_amd64.deb`,
	LINUX_DEB_ARM64: `${DOWNLOAD_BASE_URL}p2p-kiwi_arm64.deb`,
	LINUX_APPIMAGE_X86_64: `${DOWNLOAD_BASE_URL}p2p-kiwi_x86_64.AppImage`,
	LINUX_APPIMAGE_ARM64: `${DOWNLOAD_BASE_URL}p2p-kiwi_arm64.AppImage`,
	LINUX_FLATPAK_X86_64: `${DOWNLOAD_BASE_URL}p2p-kiwi_x86_64.flatpak`,
	LINUX_FLATPAK_AARCH64: `${DOWNLOAD_BASE_URL}p2p-kiwi_aarch64.flatpak`,
	LINUX_SNAP_AMD64: `${DOWNLOAD_BASE_URL}p2p-kiwi_amd64.snap`,
	MACOS_UNIVERSAL_DMG: `${DOWNLOAD_BASE_URL}p2p-kiwi_universal.dmg`,
	WINDOWS_X64_INSTALLER: `${DOWNLOAD_BASE_URL}p2p-kiwi-setup_x64.exe`,
	WINDOWS_STORE: 'https://apps.microsoft.com/detail/xp9mf77594wscg'
} as const;
