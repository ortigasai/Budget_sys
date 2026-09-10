"""JWT verification, mirroring backend/src/middleware/auth.ts. A token
signed by the Node backend's POST /auth/login is valid here too - same
secret, same `sub` claim as the user id.
"""

from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlmodel import Session, select

from .db import get_session
from .models_phase1 import RoleAssignment, SbuRoleAssignment, User
from .settings import settings

_bearer = HTTPBearer(auto_error=False)


@dataclass
class AuthedRole:
    roleType: str
    # Phase 3's BU_FINANCE_HEAD/BU_HEAD/BU_FINANCE_OFFICER are SBU-scoped
    # rather than department-scoped - departmentId is None and sbu is set
    # for those, the reverse for every other (department-scoped) role.
    departmentId: str | None = None
    sbu: str | None = None


@dataclass
class AuthedUser:
    id: str
    name: str
    email: str
    departmentId: str | None
    roles: list[AuthedRole]

    def has_role(self, role_type: str, department_id: str | None = None) -> bool:
        return any(
            r.roleType == role_type and (department_id is None or r.departmentId == department_id)
            for r in self.roles
        )

    def has_sbu_role(self, role_type: str, sbu: str | None = None) -> bool:
        return any(r.roleType == role_type and (sbu is None or r.sbu == sbu) for r in self.roles)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: Session = Depends(get_session),
) -> AuthedUser:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required.")

    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_secret, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token.")

    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token.")

    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists.")

    roles = session.exec(select(RoleAssignment).where(RoleAssignment.userId == user_id)).all()
    sbu_roles = session.exec(select(SbuRoleAssignment).where(SbuRoleAssignment.userId == user_id)).all()

    return AuthedUser(
        id=user.id,
        name=user.name,
        email=user.email,
        departmentId=user.departmentId,
        roles=[AuthedRole(roleType=r.roleType, departmentId=r.departmentId) for r in roles]
        + [AuthedRole(roleType=r.roleType, sbu=r.sbu) for r in sbu_roles],
    )


def require_role(*role_types: str):
    """Guards a route to users holding at least one of the given role types,
    anywhere - department-scoped checks happen in the route handler where the
    relevant department id is known. Mirrors requireRole() in the Node backend.
    """

    def dependency(user: AuthedUser = Depends(get_current_user)) -> AuthedUser:
        if not any(r.roleType in role_types for r in user.roles):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not hold a role permitted to perform this action.")
        return user

    return dependency
