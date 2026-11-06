//! Lightweight hashing for bounded internal numeric IDs; iteration order is never semantic.
use std::hash::{BuildHasherDefault, Hasher};
#[derive(Default)]
pub struct NumericHasher(u32);
impl NumericHasher {
    fn mix(&mut self, x: u32) {
        self.0 = self
            .0
            .rotate_left(5)
            .wrapping_add(x)
            .wrapping_mul(0x9e3779b9);
    }
}
impl Hasher for NumericHasher {
    fn finish(&self) -> u64 {
        (self.0 as u64).wrapping_mul(0x9e3779b97f4a7c15)
    }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.mix(b as u32);
        }
    }
    fn write_usize(&mut self, x: usize) {
        self.mix(x as u32);
    }
    fn write_u64(&mut self, x: u64) {
        self.mix(x as u32);
        self.mix((x >> 32) as u32);
    }
    fn write_i64(&mut self, x: i64) {
        self.write_u64(x as u64);
    }
    fn write_u32(&mut self, x: u32) {
        self.mix(x);
    }
    fn write_i32(&mut self, x: i32) {
        self.mix(x as u32);
    }
    fn write_u8(&mut self, x: u8) {
        self.mix(x as u32);
    }
}
pub type Map<K, V> = std::collections::HashMap<K, V, BuildHasherDefault<NumericHasher>>;
pub type Set<K> = std::collections::HashSet<K, BuildHasherDefault<NumericHasher>>;
