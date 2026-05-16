"""Re-exports for convenience and to ensure all models are loaded by Alembic."""
from models.access import AccountLink
from models.base import Base
from models.classroom import Classroom, Student
from models.curriculum import (
    CUSTOM_SUBJECT_DEFAULT_PROFILE,
    SUBJECT_WEIGHT_PROFILES,
    SYSTEM_CATEGORY_DEFAULTS,
    SYSTEM_CATEGORY_KEYS,
    SYSTEM_SUBJECT_KEYS,
    Category,
    Item,
    Semester,
    Subject,
    SubjectCategoryWeight,
    item_classroom,
)
from models.grading import Grade, PointRecord, PointRule, StudentStandard
from models.settings import UserSettings

__all__ = [
    "AccountLink",
    "Base",
    "Category",
    "Classroom",
    "Grade",
    "Item",
    "PointRecord",
    "PointRule",
    "SYSTEM_CATEGORY_DEFAULTS",
    "SYSTEM_CATEGORY_KEYS",
    "SYSTEM_SUBJECT_KEYS",
    "Semester",
    "Student",
    "StudentStandard",
    "Subject",
    "SubjectCategoryWeight",
    "SUBJECT_WEIGHT_PROFILES",
    "CUSTOM_SUBJECT_DEFAULT_PROFILE",
    "UserSettings",
    "item_classroom",
]
