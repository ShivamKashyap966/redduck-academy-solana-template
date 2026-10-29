use anchor_lang::prelude::*;

/// Loyalty tier of a donor. The variant order is the on-chain/return encoding —
/// don't change it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tier {
    None,
    Bronze,
    Silver,
    Gold,
    Platinum,
}

impl Tier {
    pub fn from_total(total: u64) -> Self {
        const SOL: u64 = 1_000_000_000;
        if total == 0 {
            Tier::None
        } else if total < SOL / 10 {
            Tier::Bronze
        } else if total < SOL {
            Tier::Silver
        } else if total < 10 * SOL {
            Tier::Gold
        } else {
            Tier::Platinum
        }
    }
}
