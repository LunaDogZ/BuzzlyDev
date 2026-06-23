/**
 * @deprecated usePersonas queries the legacy `persona_definition` table, which is
 * an owner-level product-analytics table (AARRR funnel, user segmentation) and is
 * NOT the same as the marketing persona system used across customer pages.
 *
 * For marketing/campaign personas (Prospects page, audience discovery, ad targeting)
 * use `useCustomerPersonas` from "@/hooks/useCustomerPersonas" instead.
 *
 * This hook is retained only for `pages/owner/ProductUsage.tsx`, which manages
 * internal Buzzly user-segment personas — a distinct concept from customer personas.
 * Do NOT introduce new usages of this hook elsewhere.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export type PersonaDefinition = Database["public"]["Tables"]["persona_definition"]["Row"];

export interface CreatePersonaInput {
    name: string;
    description?: string;
    demographics?: Json;
    behaviors?: Json;
    characteristics?: Json;
}

export function usePersonas() {
    const queryClient = useQueryClient();

    const { data: personas = [], isLoading } = useQuery({
        queryKey: ["personas"],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("persona_definition")
                .select("*")
                .eq("is_active", true)
                .order("created_at", { ascending: false });

            if (error) throw error;
            return data as PersonaDefinition[];
        },
    });

    const createPersona = useMutation({
        mutationFn: async (input: CreatePersonaInput) => {
            const { data, error } = await supabase
                .from("persona_definition")
                .insert({
                    name: input.name,
                    description: input.description,
                    demographics: input.demographics || {},
                    behaviors: input.behaviors || {},
                    characteristics: input.characteristics || {},
                    is_active: true
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["personas"] });
        },
    });

    const deletePersona = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from("persona_definition")
                .update({ is_active: false })
                .eq("id", id);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["personas"] });
        },
    });

    return {
        personas,
        isLoading,
        createPersona,
        deletePersona,
    };
}
