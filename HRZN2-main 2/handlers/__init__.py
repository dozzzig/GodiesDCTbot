# handlers/__init__.py
from .admin import router as admin_router
from .instructions import router as instructions_router
from .menu import router as menu_router
from .payment import router as payment_router
from .start import router as start_router

__all__ = ["start_router", "payment_router", "menu_router", "admin_router", "instructions_router"]
