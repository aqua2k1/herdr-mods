"""Windows credential-file access controls (not encryption).

These helpers use native, protected DACLs. They do not encrypt file contents or
protect against administrators, backup privileges, or compromise of this user.
Only import this module on Windows. Paths must be in trusted parent directories:
opening the final component without following reparse points does not prevent
redirection through an ancestor directory.
"""

import ctypes
from ctypes import wintypes as w
import msvcrt
import os


_kernel = ctypes.WinDLL("kernel32", use_last_error=True)
_advapi = ctypes.WinDLL("advapi32", use_last_error=True)

_DWORD = w.DWORD
_PTR = ctypes.c_void_p
_PDWORD = ctypes.POINTER(_DWORD)
_PPTR = ctypes.POINTER(_PTR)


class _SID_AND_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("Sid", _PTR), ("Attributes", _DWORD)]


class _TOKEN_USER(ctypes.Structure):
    _fields_ = [("User", _SID_AND_ATTRIBUTES)]


class _TOKEN_OWNER(ctypes.Structure):
    _fields_ = [("Owner", _PTR)]


class _FILE_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("dwFileAttributes", _DWORD),
        ("ftCreationTime", w.FILETIME),
        ("ftLastAccessTime", w.FILETIME),
        ("ftLastWriteTime", w.FILETIME),
        ("dwVolumeSerialNumber", _DWORD),
        ("nFileSizeHigh", _DWORD),
        ("nFileSizeLow", _DWORD),
        ("nNumberOfLinks", _DWORD),
        ("nFileIndexHigh", _DWORD),
        ("nFileIndexLow", _DWORD),
    ]


class _ACL_SIZE_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("AceCount", _DWORD), ("AclBytesInUse", _DWORD),
        ("AclBytesFree", _DWORD),
    ]


class _ACE_HEADER(ctypes.Structure):
    _fields_ = [("AceType", w.BYTE), ("AceFlags", w.BYTE),
                ("AceSize", w.WORD)]


def _bind(dll, name, args, result):
    function = getattr(dll, name)
    function.argtypes = args
    function.restype = result
    return function


_GetCurrentProcess = _bind(_kernel, "GetCurrentProcess", [], w.HANDLE)
_CloseHandle = _bind(_kernel, "CloseHandle", [w.HANDLE], w.BOOL)
_LocalFree = _bind(_kernel, "LocalFree", [_PTR], _PTR)
_CreateFile = _bind(_kernel, "CreateFileW", [
    w.LPCWSTR, _DWORD, _DWORD, _PTR, _DWORD, _DWORD, w.HANDLE,
], w.HANDLE)
_GetFileType = _bind(_kernel, "GetFileType", [w.HANDLE], _DWORD)
_GetFileInformation = _bind(_kernel, "GetFileInformationByHandle", [
    w.HANDLE, ctypes.POINTER(_FILE_INFORMATION),
], w.BOOL)
_GetVolumeInformation = _bind(_kernel, "GetVolumeInformationByHandleW", [
    w.HANDLE, w.LPWSTR, _DWORD, _PDWORD, _PDWORD, _PDWORD,
    w.LPWSTR, _DWORD,
], w.BOOL)
_OpenProcessToken = _bind(_advapi, "OpenProcessToken", [
    w.HANDLE, _DWORD, ctypes.POINTER(w.HANDLE),
], w.BOOL)
_GetTokenInformation = _bind(_advapi, "GetTokenInformation", [
    w.HANDLE, ctypes.c_int, _PTR, _DWORD, _PDWORD,
], w.BOOL)
_CreateWellKnownSid = _bind(_advapi, "CreateWellKnownSid", [
    ctypes.c_int, _PTR, _PTR, _PDWORD,
], w.BOOL)
_EqualSid = _bind(_advapi, "EqualSid", [_PTR, _PTR], w.BOOL)
_IsValidSid = _bind(_advapi, "IsValidSid", [_PTR], w.BOOL)
_ConvertSidToStringSid = _bind(_advapi, "ConvertSidToStringSidW", [
    _PTR, _PPTR,
], w.BOOL)
_ConvertStringSecurityDescriptor = _bind(
    _advapi, "ConvertStringSecurityDescriptorToSecurityDescriptorW",
    [w.LPCWSTR, _DWORD, _PPTR, _PDWORD], w.BOOL,
)
_GetSecurityInfo = _bind(_advapi, "GetSecurityInfo", [
    w.HANDLE, ctypes.c_int, _DWORD, _PPTR, _PPTR, _PPTR, _PPTR, _PPTR,
], _DWORD)
_SetSecurityInfo = _bind(_advapi, "SetSecurityInfo", [
    w.HANDLE, ctypes.c_int, _DWORD, _PTR, _PTR, _PTR, _PTR,
], _DWORD)
_GetSecurityDescriptorControl = _bind(_advapi, "GetSecurityDescriptorControl", [
    _PTR, ctypes.POINTER(w.WORD), _PDWORD,
], w.BOOL)
_GetSecurityDescriptorDacl = _bind(_advapi, "GetSecurityDescriptorDacl", [
    _PTR, ctypes.POINTER(w.BOOL), _PPTR, ctypes.POINTER(w.BOOL),
], w.BOOL)
_IsValidAcl = _bind(_advapi, "IsValidAcl", [_PTR], w.BOOL)
_GetAclInformation = _bind(_advapi, "GetAclInformation", [
    _PTR, _PTR, _DWORD, ctypes.c_int,
], w.BOOL)
_GetAce = _bind(_advapi, "GetAce", [_PTR, _DWORD, _PPTR], w.BOOL)

_READ_CONTROL = 0x00020000
_WRITE_DAC = 0x00040000
_WRITE_OWNER = 0x00080000
_FILE_READ_ATTRIBUTES = 0x80
_GENERIC_READ = 0x80000000
_FILE_ATTRIBUTE_DIRECTORY = 0x10
_FILE_ATTRIBUTE_REPARSE_POINT = 0x400
_OWNER_SECURITY_INFORMATION = 0x1
_DACL_SECURITY_INFORMATION = 0x4
_PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000
_SE_DACL_PRESENT = 0x4
_SE_DACL_PROTECTED = 0x1000
_INVALID_HANDLE = ctypes.c_void_p(-1).value


def _check(success):
    if not success:
        raise ctypes.WinError(ctypes.get_last_error())


def _token_information(information_class, structure):
    """Return a process-token buffer, keeping its embedded SID alive."""
    token = w.HANDLE()
    _check(_OpenProcessToken(_GetCurrentProcess(), 0x8, ctypes.byref(token)))
    try:
        size = _DWORD()
        success = _GetTokenInformation(token, information_class, None, 0, ctypes.byref(size))
        if success or ctypes.get_last_error() != 122:  # INSUFFICIENT_BUFFER
            raise ctypes.WinError(ctypes.get_last_error())
        if size.value < ctypes.sizeof(structure):
            raise ValueError("invalid token information")
        buffer = ctypes.create_string_buffer(size.value)
        _check(_GetTokenInformation(token, information_class, buffer, size,
                                    ctypes.byref(size)))
        sid = structure.from_buffer(buffer)
        _check(_IsValidSid(sid.User.Sid if information_class == 1 else sid.Owner))
        return buffer
    finally:
        _CloseHandle(token)


def _current_user():
    return _token_information(1, _TOKEN_USER)  # TokenUser


def _current_owner():
    return _token_information(4, _TOKEN_OWNER)  # TokenOwner, not TokenPrimaryGroup


def _user_sid(buffer):
    return _TOKEN_USER.from_buffer(buffer).User.Sid


def _open(path, access):
    path = os.fsdecode(os.fspath(path))
    if "\0" in path:
        raise ValueError("embedded null in path")
    # Share READ only; neither writers nor deleters may coexist with this handle.
    handle = _CreateFile(path, access, 0x1, None, 3,
                         0x00200000 | 0x02000000, None)
    if handle == _INVALID_HANDLE:
        error = ctypes.get_last_error()
        if error in (2, 3):
            raise FileNotFoundError(error, "credential path not found", path)
        raise ctypes.WinError(error)
    return handle


def _file_info(handle):
    if _GetFileType(handle) != 1:  # FILE_TYPE_DISK
        raise ValueError("credential path is not a disk object")
    info = _FILE_INFORMATION()
    _check(_GetFileInformation(handle, ctypes.byref(info)))
    if info.dwFileAttributes & _FILE_ATTRIBUTE_REPARSE_POINT:
        raise ValueError("credential path is a reparse point")
    flags = _DWORD()
    _check(_GetVolumeInformation(handle, None, 0, None, None,
                                 ctypes.byref(flags), None, 0))
    if not flags.value & 0x8:  # FILE_PERSISTENT_ACLS
        raise ValueError("filesystem does not support persistent ACLs")
    return info


def _require_owner(handle, user, default_owner=None):
    """Return whether secure() must normalize the process's default owner.

    No group-membership or privilege-based ownership exceptions are allowed.
    """
    descriptor, owner = _PTR(), _PTR()
    error = _GetSecurityInfo(
        handle, 1, _OWNER_SECURITY_INFORMATION, ctypes.byref(owner),
        None, None, None, ctypes.byref(descriptor),
    )
    try:
        if error:
            raise ctypes.WinError(error)
        if not owner.value or not _IsValidSid(owner):
            raise ValueError("invalid credential owner")
        if _EqualSid(owner, user):
            return False
        if default_owner is not None and _EqualSid(owner, default_owner):
            return True
        raise ValueError("credential owner is not the current user or token owner")
    finally:
        if descriptor.value:
            _LocalFree(descriptor)


def _validate_handle(handle, user):
    info = _file_info(handle)
    descriptor, owner, dacl = _PTR(), _PTR(), _PTR()
    error = _GetSecurityInfo(
        handle, 1, _OWNER_SECURITY_INFORMATION | _DACL_SECURITY_INFORMATION,
        ctypes.byref(owner), None, ctypes.byref(dacl), None,
        ctypes.byref(descriptor),
    )
    try:
        if error:
            raise ctypes.WinError(error)
        if not owner.value or not _IsValidSid(owner) or not _EqualSid(owner, user):
            raise ValueError("credential owner is not the current user")
        control, revision = w.WORD(), _DWORD()
        _check(_GetSecurityDescriptorControl(descriptor, ctypes.byref(control),
                                             ctypes.byref(revision)))
        required = _SE_DACL_PRESENT | _SE_DACL_PROTECTED
        if control.value & required != required or not dacl.value:
            raise ValueError("credential DACL must be non-null and protected")
        _check(_IsValidAcl(dacl))
        acl_info = _ACL_SIZE_INFORMATION()
        _check(_GetAclInformation(dacl, ctypes.byref(acl_info),
                                  ctypes.sizeof(acl_info), 2))
        system = ctypes.create_string_buffer(68)  # SECURITY_MAX_SID_SIZE
        size = _DWORD(len(system))
        _check(_CreateWellKnownSid(22, None, system, ctypes.byref(size)))
        for index in range(acl_info.AceCount):
            ace = _PTR()
            _check(_GetAce(dacl, index, ctypes.byref(ace)))
            header = _ACE_HEADER.from_address(ace.value)
            # Only simple ACCESS_ALLOWED_ACE entries, including OI/CI and the
            # inherited marker. Deny, object, callback and inherit-only fail shut.
            if header.AceType != 0 or header.AceFlags & ~0x13:
                raise ValueError("unsupported credential ACE")
            # ACCESS_ALLOWED_ACE: header (4), mask (4), variable-length SID.
            if header.AceSize < 16:
                raise ValueError("invalid credential ACE")
            sid = ace.value + 8
            subauthorities = ctypes.c_ubyte.from_address(sid + 1).value
            if 8 + 8 + 4 * subauthorities > header.AceSize:
                raise ValueError("invalid credential ACE SID")
            if not _IsValidSid(sid):
                raise ValueError("invalid credential ACE SID")
            if not (_EqualSid(sid, user) or _EqualSid(sid, system)):
                raise ValueError("credential DACL grants access to another user")
        return info
    finally:
        if descriptor.value:
            _LocalFree(descriptor)


def secure(path):
    """Set a protected user/System full-control DACL; no content encryption.

    Directory grants inherit to files and subdirectories (OI/CI). Descendants
    must still be validated individually before use. Only the process TokenUser
    or TokenOwner may own the object initially; TokenOwner (often Administrators
    when elevated) is explicitly replaced with TokenUser. Foreign owners and
    reparse points are rejected before any security change. Validation and reads
    still require TokenUser ownership without exceptions.
    """
    token = _current_user()
    owner_token = _current_owner()
    user = _user_sid(token)
    default_owner = _TOKEN_OWNER.from_buffer(owner_token).Owner
    handle = _open(path, _READ_CONTROL | _WRITE_DAC | _FILE_READ_ATTRIBUTES)
    owner_handle = None
    descriptor, sid_text = _PTR(), _PTR()
    try:
        info = _file_info(handle)
        normalize_owner = _require_owner(handle, user, default_owner)
        if normalize_owner:
            # Request WRITE_OWNER only when needed. The original handle keeps
            # write/delete sharing denied while the second handle is opened.
            owner_handle = _open(path, _WRITE_OWNER)

        _check(_ConvertSidToStringSid(user, ctypes.byref(sid_text)))
        inheritance = "OICI" if info.dwFileAttributes & _FILE_ATTRIBUTE_DIRECTORY else ""
        sddl = (f"D:P(A;{inheritance};FA;;;{ctypes.wstring_at(sid_text)})"
                f"(A;{inheritance};FA;;;SY)")
        _check(_ConvertStringSecurityDescriptor(sddl, 1,
                                                ctypes.byref(descriptor), None))
        present, defaulted, dacl = w.BOOL(), w.BOOL(), _PTR()
        _check(_GetSecurityDescriptorDacl(descriptor, ctypes.byref(present),
                                          ctypes.byref(dacl), ctypes.byref(defaulted)))
        error = _SetSecurityInfo(
            handle, 1, _DACL_SECURITY_INFORMATION | _PROTECTED_DACL_SECURITY_INFORMATION,
            None, None, dacl, None,
        )
        if error:
            raise ctypes.WinError(error)
        if normalize_owner:
            error = _SetSecurityInfo(
                owner_handle, 1, _OWNER_SECURITY_INFORMATION,
                user, None, None, None,
            )
            if error:
                raise ctypes.WinError(error)
        _validate_handle(handle, user)
    finally:
        if owner_handle is not None:
            _CloseHandle(owner_handle)
        if descriptor.value:
            _LocalFree(descriptor)
        if sid_text.value:
            _LocalFree(sid_text)
        _CloseHandle(handle)


def validate(path):
    """Reject unsafe ownership, DACLs, filesystems and final reparse points.

    This checks access controls, not encryption, and is only a snapshot. Use
    open_private() rather than a separate validation followed by a normal open.
    """
    token = _current_user()
    handle = _open(path, _READ_CONTROL | _FILE_READ_ATTRIBUTES)
    try:
        _validate_handle(handle, _user_sid(token))
    finally:
        _CloseHandle(handle)


def open_private(path):
    """Return an owned read-only binary fd for a validated, unencrypted file.

    Validation uses the actual open handle. The fd denies write/delete sharing
    until closed; the caller must close it (for example with os.fdopen(fd, 'rb')).
    Missing paths raise FileNotFoundError. Directories and reparse points fail.
    """
    token = _current_user()
    handle = _open(path, _GENERIC_READ | _READ_CONTROL)
    try:
        info = _validate_handle(handle, _user_sid(token))
        if info.dwFileAttributes & _FILE_ATTRIBUTE_DIRECTORY:
            raise ValueError("credential path is a directory")
        fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        handle = None  # The CRT fd now owns the handle.
        return fd
    finally:
        if handle is not None:
            _CloseHandle(handle)
