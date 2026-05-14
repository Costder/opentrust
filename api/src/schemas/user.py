from pydantic import BaseModel


class UserRead(BaseModel):
    id: str
    username: str
    github_id: str | None = None
    email: str | None = None
