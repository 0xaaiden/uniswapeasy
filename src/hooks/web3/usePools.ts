import type { BigintIsh, Currency, Token } from "@uniswap/sdk-core";
import { useWeb3React } from "@web3-react/core";
import JSBI from "jsbi";
import { useEffect, useMemo, useState } from "react";
import { PoolKeyStruct } from "../../abis/types/PoolManager";
import { type BigNumberish } from "ethers";
import { Pool } from "../../entities/pool";
import { useTestnetContract } from "../../hooks/web3/useContract";
import { keccak256, defaultAbiCoder, Result } from "ethers/lib/utils";

// Classes are expensive to instantiate, so this caches the recently instantiated pools.
// This avoids re-instantiating pools as the other pools in the same request are loaded.
class PoolCache {
  // Evict after 128 entries. Empirically, a swap uses 64 entries.
  private static MAX_ENTRIES = 128;

  // These are FIFOs, using unshift/pop. This makes recent entries faster to find.
  private static pools: Pool[] = [];
  private static poolKeys: PoolKeyStruct[] = [];

  static getPoolKeys(
    tokenA: Token,
    tokenB: Token,
    fee: BigNumberish,
    tickSpacing: BigNumberish,
    hooks: string
  ): PoolKeyStruct {
    if (this.poolKeys.length > this.MAX_ENTRIES) {
      this.poolKeys = this.poolKeys.slice(0, this.MAX_ENTRIES / 2);
    }
    const key: PoolKeyStruct = {
      currency0: tokenA.address,
      currency1: tokenB.address,
      fee,
      tickSpacing,
      hooks,
    };

    const found = this.poolKeys.find((currentKey) => currentKey === key);
    if (found) return found;

    this.poolKeys.unshift(key);
    return key;
  }

  static getPool(
    tokenA: Token,
    tokenB: Token,
    fee: BigNumberish,
    sqrtPriceX96: BigintIsh,
    liquidity: BigintIsh,
    tickSpacing: BigNumberish,
    tick: number
  ): Pool {
    if (this.pools.length > this.MAX_ENTRIES) {
      this.pools = this.pools.slice(0, this.MAX_ENTRIES / 2);
    }

    const found = this.pools.find(
      (pool) =>
        pool.token0 === tokenA &&
        pool.token1 === tokenB &&
        JSBI.EQ(pool.fee, fee) &&
        JSBI.EQ(pool.sqrtRatioX96, sqrtPriceX96) &&
        JSBI.EQ(pool.liquidity, liquidity) &&
        pool.tickCurrent === tick
    );
    if (found) return found;

    const pool = new Pool(
      tokenA,
      tokenB,
      fee,
      sqrtPriceX96,
      liquidity,
      tickSpacing,
      tick
    );
    this.pools.unshift(pool);
    return pool;
  }
}

export enum PoolState {
  LOADING,
  NOT_EXISTS,
  EXISTS,
  INVALID,
}

export function usePool(
  currencyA: Currency | undefined,
  currencyB: Currency | undefined,
  feeAmount: BigNumberish | undefined,
  tickSpacing: BigNumberish | undefined,
  hooks: string | undefined
): [PoolState, Pool | null] {
  const { chainId, provider } = useWeb3React();

  const [slot0, setSlot0] = useState<
    undefined | { result: Result | undefined; loading: boolean; valid: boolean }
  >(undefined);

  const [liquidity, setLiquidity] = useState<
    undefined | { result: Result | undefined; loading: boolean; valid: boolean }
  >(undefined);

  const poolToken:
    | [Token, Token, BigNumberish, BigNumberish, string]
    | undefined = useMemo(() => {
    if (!chainId) return undefined;
    if (currencyA && currencyB && feeAmount && tickSpacing && hooks) {
      const tokenA = currencyA.wrapped;
      const tokenB = currencyB.wrapped;
      if (tokenA.equals(tokenB)) return undefined;

      return tokenA.sortsBefore(tokenB)
        ? [tokenA, tokenB, feeAmount, tickSpacing, hooks]
        : [tokenB, tokenA, feeAmount, tickSpacing, hooks];
    }
    return undefined;
  }, [chainId, currencyA, currencyB, feeAmount, tickSpacing, hooks]);

  const poolKey: PoolKeyStruct | undefined = useMemo(() => {
    return (
      poolToken && {
        currency0: poolToken[0].address,
        currency1: poolToken[1].address,
        fee: poolToken[2],
        tickSpacing: poolToken[3],
        hooks: poolToken[4],
      }
    );
  }, [chainId, poolToken]);

  const id = useMemo(() => {
    return toId(poolKey);
  }, [poolKey, chainId]);

  const poolManagerContract = useTestnetContract();

  useEffect(() => {
    if (!poolManagerContract || !id || !provider || !chainId || !poolKey) {
      setSlot0(undefined);
      setLiquidity(undefined);
      return;
    }

    const slot0Data = poolManagerContract.interface.encodeFunctionData(
      "getSlot0",
      [id]
    );
    const liquidityData = poolManagerContract.interface.encodeFunctionData(
      "getLiquidity(bytes32)",
      [id]
    );

    setSlot0({ result: undefined, loading: true, valid: true });
    setLiquidity({ result: undefined, loading: true, valid: true });

    const s0 = provider.call({
      to: poolManagerContract?.address,
      data: slot0Data,
    });
    const lts = provider.call({
      to: poolManagerContract?.address,
      data: liquidityData,
    });

    Promise.all([s0, lts])
      .then(([resolvedSlot0, resolvedLiquidity]) => {
        const resolvedSlot0Decoded =
          poolManagerContract.interface.decodeFunctionResult(
            "getSlot0",
            resolvedSlot0
          );
        const resolvedLiquidityDecoded =
          poolManagerContract?.interface.decodeFunctionResult(
            "getLiquidity(bytes32)",
            resolvedLiquidity
          );

        setSlot0({ result: resolvedSlot0Decoded, loading: false, valid: true });
        setLiquidity({
          result: resolvedLiquidityDecoded,
          loading: false,
          valid: true,
        });
      })
      .catch((error) => {
        setSlot0({ result: undefined, loading: false, valid: false });
        setLiquidity({ result: undefined, loading: false, valid: false });
      });
  }, [poolKey, poolManagerContract, provider, chainId]);

  return useMemo(() => {
    if (!poolToken) return [PoolState.INVALID, null];
    const [token0, token1, fee] = poolToken;

    if (!slot0) return [PoolState.INVALID, null];
    const { result: slot0d, loading: slot0Loading, valid: slot0Valid } = slot0;

    if (!liquidity) return [PoolState.INVALID, null];
    const {
      result: liquidityd,
      loading: liquidityLoading,
      valid: liquidityValid,
    } = liquidity;

    if (!poolToken || !slot0Valid || !liquidityValid)
      return [PoolState.INVALID, null];
    if (slot0Loading || liquidityLoading) return [PoolState.LOADING, null];
    if (!slot0d || !liquidityd) return [PoolState.NOT_EXISTS, null];
    if (!slot0d.sqrtPriceX96 || JSBI.EQ(slot0d.sqrtPriceX96, 0))
      return [PoolState.NOT_EXISTS, null];

    try {
      //TODO
      //slot0 doesn't return tickSpacing, look into this
      const pool = PoolCache.getPool(
        token0,
        token1,
        fee,
        JSBI.BigInt(slot0d.sqrtPriceX96),
        JSBI.BigInt(liquidityd),
        poolKey?.tickSpacing ?? 60,
        slot0d.tick
      );
      return [PoolState.EXISTS, pool];
    } catch (error) {
      console.error("Error when constructing the pool", error);
      return [PoolState.NOT_EXISTS, null];
    }
  }, [liquidity, poolKey, slot0, poolToken]);
}

function toId(poolKey?: PoolKeyStruct): string | undefined {
  if (!poolKey) return undefined;

  const params = defaultAbiCoder.encode(
    ["address", "address", "uint24", "uint24", "address"],
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks,
    ]
  );
  const hash = keccak256(params);
  console.log("poolId", hash);

  return hash;
}
