import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export interface CustomerPersona {
  id: string;
  team_id: string;
  persona_name: string;
  description: string | null;
  avatar_url: string | null;
  gender_id: string | null;
  age_min: number | null;
  age_max: number | null;
  location_id: string | null;
  profession: string | null;
  company_size: string | null;
  salary_range: string | null;
  industry: string | null;
  preferred_devices: string[] | null;
  active_hours: string | null;
  interests: string[] | null;
  pain_points: string[] | null;
  goals: string[] | null;
  custom_fields: Json | null;
  is_active: boolean;
  is_template: boolean;
  psychographics: Json | null;
  ad_targeting_mapping: Json | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface CustomerPersonaInsert {
  team_id: string;
  persona_name: string;
  description?: string | null;
  avatar_url?: string | null;
  gender_id?: string | null;
  age_min?: number | null;
  age_max?: number | null;
  location_id?: string | null;
  profession?: string | null;
  company_size?: string | null;
  salary_range?: string | null;
  industry?: string | null;
  preferred_devices?: string[] | null;
  active_hours?: string | null;
  interests?: string[] | null;
  pain_points?: string[] | null;
  goals?: string[] | null;
  custom_fields?: Json | null;
  is_active?: boolean;
  is_template?: boolean;
  psychographics?: Json | null;
  ad_targeting_mapping?: Json | null;
}

export interface CustomerPersonaUpdate extends Partial<CustomerPersonaInsert> {
  id: string;
}

export const useCustomerPersonas = (teamId: string | null) => {
  const queryClient = useQueryClient();

  // Fetch all personas — RLS SELECT is open so all authenticated users see all data
  const {
    data: personas,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["customer-personas", teamId],
    queryFn: async () => {
      if (!teamId) return [];
      const { data, error } = await supabase
        .from("customer_personas")
        .select("*")
        .or(`team_id.eq.${teamId},is_template.eq.true`)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as CustomerPersona[];
    },
    enabled: !!teamId,
  });

  // Fetch genders for dropdown
  const { data: genders } = useQuery({
    queryKey: ["genders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("genders")
        .select("id, name_gender");
      if (error) throw error;
      return data;
    },
  });

  // Fetch locations for dropdown
  const { data: locations } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, district, province_id");
      if (error) throw error;
      return data;
    },
  });

  // Create a new persona
  const createPersona = useMutation({
    mutationFn: async (newPersona: CustomerPersonaInsert) => {
      const { data: user } = await getCurrentUser();

      const { data, error } = await supabase
        .from("customer_personas")
        .insert({
          team_id: newPersona.team_id,
          persona_name: newPersona.persona_name,
          description: newPersona.description,
          avatar_url: newPersona.avatar_url,
          gender_id: newPersona.gender_id,
          age_min: newPersona.age_min,
          age_max: newPersona.age_max,
          location_id: newPersona.location_id,
          profession: newPersona.profession,
          company_size: newPersona.company_size,
          salary_range: newPersona.salary_range,
          industry: newPersona.industry,
          preferred_devices: newPersona.preferred_devices,
          active_hours: newPersona.active_hours,
          interests: newPersona.interests,
          pain_points: newPersona.pain_points,
          goals: newPersona.goals,
          custom_fields: newPersona.custom_fields,
          is_active: newPersona.is_active ?? true,
          is_template: newPersona.is_template ?? false,
          psychographics: newPersona.psychographics,
          ad_targeting_mapping: newPersona.ad_targeting_mapping,
          created_by: user?.user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-personas", teamId] });
      toast.success("สร้าง Persona สำเร็จ!");
    },
    onError: (error) => {
      console.error("Error creating persona:", error);
      toast.error("ไม่สามารถสร้าง Persona ได้");
    },
  });

  // Update an existing persona
  const updatePersona = useMutation({
    mutationFn: async ({ id, ...updates }: CustomerPersonaUpdate) => {
      const { data, error } = await supabase
        .from("customer_personas")
        .update({
          persona_name: updates.persona_name,
          description: updates.description,
          avatar_url: updates.avatar_url,
          gender_id: updates.gender_id,
          age_min: updates.age_min,
          age_max: updates.age_max,
          location_id: updates.location_id,
          profession: updates.profession,
          company_size: updates.company_size,
          salary_range: updates.salary_range,
          industry: updates.industry,
          preferred_devices: updates.preferred_devices,
          active_hours: updates.active_hours,
          interests: updates.interests,
          pain_points: updates.pain_points,
          goals: updates.goals,
          custom_fields: updates.custom_fields,
          is_active: updates.is_active,
          is_template: updates.is_template,
          psychographics: updates.psychographics,
          ad_targeting_mapping: updates.ad_targeting_mapping,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-personas", teamId] });
      toast.success("อัปเดต Persona สำเร็จ!");
    },
    onError: (error) => {
      console.error("Error updating persona:", error);
      toast.error("ไม่สามารถอัปเดต Persona ได้");
    },
  });

  // Soft delete a persona
  const deletePersona = useMutation({
    mutationFn: async (personaId: string) => {
      const { error } = await supabase
        .from("customer_personas")
        .update({ is_active: false })
        .eq("id", personaId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-personas", teamId] });
      toast.success("ลบ Persona สำเร็จ!");
    },
    onError: (error) => {
      console.error("Error deleting persona:", error);
      toast.error("ไม่สามารถลบ Persona ได้");
    },
  });

  // Get aggregated stats for visualization
  const getPersonaStats = () => {
    if (!personas || personas.length === 0) {
      return {
        genderDistribution: [],
        ageDistribution: [],
        salaryDistribution: [],
        deviceDistribution: [],
        interestDistribution: [],
        professionDistribution: [],
      };
    }

    // Gender distribution (using gender_id to match with genders list)
    const genderCounts: Record<string, number> = {};
    personas.forEach((p) => {
      const gender = genders?.find(g => g.id === p.gender_id)?.name_gender || "ไม่ระบุ";
      genderCounts[gender] = (genderCounts[gender] || 0) + 1;
    });
    const genderDistribution = Object.entries(genderCounts).map(([name, value]) => ({
      name,
      value,
    }));

    // Age distribution (grouped)
    const ageGroups: Record<string, number> = {
      "18-24": 0,
      "25-34": 0,
      "35-44": 0,
      "45-54": 0,
      "55+": 0,
    };
    personas.forEach((p) => {
      if (p.age_min !== null) {
        if (p.age_min < 25) ageGroups["18-24"]++;
        else if (p.age_min < 35) ageGroups["25-34"]++;
        else if (p.age_min < 45) ageGroups["35-44"]++;
        else if (p.age_min < 55) ageGroups["45-54"]++;
        else ageGroups["55+"]++;
      }
    });
    const ageDistribution = Object.entries(ageGroups)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));

    // Salary distribution
    const salaryCounts: Record<string, number> = {};
    personas.forEach((p) => {
      if (p.salary_range) {
        salaryCounts[p.salary_range] = (salaryCounts[p.salary_range] || 0) + 1;
      }
    });
    const salaryDistribution = Object.entries(salaryCounts).map(([name, value]) => ({
      name,
      value,
    }));

    // Device distribution
    const deviceCounts: Record<string, number> = {};
    personas.forEach((p) => {
      if (p.preferred_devices) {
        p.preferred_devices.forEach((device) => {
          deviceCounts[device] = (deviceCounts[device] || 0) + 1;
        });
      }
    });
    const deviceDistribution = Object.entries(deviceCounts).map(([name, value]) => ({
      name,
      value,
    }));

    // Interest distribution
    const interestCounts: Record<string, number> = {};
    personas.forEach((p) => {
      if (p.interests) {
        p.interests.forEach((interest) => {
          interestCounts[interest] = (interestCounts[interest] || 0) + 1;
        });
      }
    });
    const interestDistribution = Object.entries(interestCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    // Profession distribution
    const professionCounts: Record<string, number> = {};
    personas.forEach((p) => {
      if (p.profession) {
        professionCounts[p.profession] = (professionCounts[p.profession] || 0) + 1;
      }
    });
    const professionDistribution = Object.entries(professionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    return {
      genderDistribution,
      ageDistribution,
      salaryDistribution,
      deviceDistribution,
      interestDistribution,
      professionDistribution,
    };
  };

  return {
    personas,
    isLoading,
    error,
    refetch,
    genders,
    locations,
    createPersona,
    updatePersona,
    deletePersona,
    getPersonaStats,
  };
};
