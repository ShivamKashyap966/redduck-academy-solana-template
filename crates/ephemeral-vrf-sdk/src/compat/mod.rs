#![allow(dead_code)]

#[cfg(all(feature = "anchor-modern", feature = "anchor-compat"))]
compile_error!("features `anchor-modern` and `anchor-compat` are mutually exclusive");

#[cfg(all(
    feature = "anchor-modern",
    feature = "backward-compat",
    not(feature = "anchor-compat")
))]
compile_error!("feature `anchor-modern` cannot be combined with `backward-compat`; use `anchor-compat` instead");

#[cfg(feature = "backward-compat")]
mod backward_compat {
    pub use borsh_compat as borsh;
    pub use solana_program_compat::instruction::{AccountMeta, Instruction};
    #[allow(deprecated)]
    pub use solana_program_compat::system_program;
    pub use solana_program_compat::{pubkey, pubkey::Pubkey};

    #[cfg(feature = "anchor-compat")]
    pub use anchor_lang_compat as anchor_lang;

    pub mod slot_hashes {
        pub const ID: super::Pubkey =
            solana_program_compat::pubkey!("SysvarS1otHashes111111111111111111111111111");
    }
}

pub(crate) mod latest {
    #[cfg(not(feature = "backward-compat"))]
    pub use borsh_current as borsh;
    pub use solana_program_compat::instruction::{AccountMeta, Instruction};
    #[cfg(not(feature = "backward-compat"))]
    pub use solana_program_compat::pubkey;
    pub use solana_program_compat::pubkey::Pubkey;
    #[allow(deprecated)]
    pub use solana_program_compat::system_program;

    #[cfg(feature = "anchor-modern")]
    pub use anchor_lang_current as anchor_lang;

    pub mod slot_hashes {
        pub const ID: super::Pubkey =
            solana_program_compat::pubkey!("SysvarS1otHashes111111111111111111111111111");
    }
}

#[cfg(feature = "backward-compat")]
pub use backward_compat::*;
#[cfg(not(feature = "backward-compat"))]
pub use latest::*;

pub trait Modern {
    type Modern;
    fn modern(self) -> Self::Modern;
}

pub trait Compat {
    type Compat;
    fn compat(self) -> Self::Compat;
}

#[cfg(feature = "backward-compat")]
impl Modern for backward_compat::Pubkey {
    type Modern = latest::Pubkey;

    fn modern(self) -> Self::Modern {
        self
    }
}

#[cfg(not(feature = "backward-compat"))]
impl Modern for latest::Pubkey {
    type Modern = latest::Pubkey;

    fn modern(self) -> Self::Modern {
        self
    }
}

#[cfg(feature = "backward-compat")]
impl Modern for backward_compat::AccountMeta {
    type Modern = latest::AccountMeta;

    fn modern(self) -> Self::Modern {
        self
    }
}

#[cfg(not(feature = "backward-compat"))]
impl Modern for latest::AccountMeta {
    type Modern = latest::AccountMeta;

    fn modern(self) -> Self::Modern {
        self
    }
}

#[cfg(feature = "backward-compat")]
impl Modern for backward_compat::Instruction {
    type Modern = latest::Instruction;

    fn modern(self) -> Self::Modern {
        self
    }
}

#[cfg(not(feature = "backward-compat"))]
impl Modern for latest::Instruction {
    type Modern = latest::Instruction;

    fn modern(self) -> Self::Modern {
        self
    }
}

impl<T: Modern> Modern for Vec<T> {
    type Modern = Vec<T::Modern>;

    fn modern(self) -> Self::Modern {
        self.into_iter().map(Modern::modern).collect()
    }
}

impl Compat for latest::Pubkey {
    type Compat = Pubkey;

    fn compat(self) -> Self::Compat {
        self
    }
}

impl Compat for latest::AccountMeta {
    type Compat = AccountMeta;

    fn compat(self) -> Self::Compat {
        self
    }
}

impl Compat for latest::Instruction {
    type Compat = Instruction;

    fn compat(self) -> Self::Compat {
        self
    }
}

impl<T: Compat> Compat for Vec<T> {
    type Compat = Vec<T::Compat>;

    fn compat(self) -> Self::Compat {
        self.into_iter().map(Compat::compat).collect()
    }
}
